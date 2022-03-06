// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../interfaces/ITiny721.sol";
import "../../libraries/EIP712.sol";

/*
  It saves bytecode to revert on custom errors instead of using require
  statements. We are just declaring these errors for reverting with upon various
  conditions later in this contract.
*/
error CannotClaimInvalidSignature();
error CannotClaimBeyondAllocation();
error CannotClaimForUnheldItem();
error SweepingTransferFailed();

/**
  @title A vault which can be filled with ERC-20 tokens that may be claimed by
    ERC-721 holders via signatures produced by a trusted off-chain signer.
  @author Tim Clancy
  @author Rostislav Khlebnikov

  This token contract allows for the implementation of off-chain systems that
  track token balances due to users in systems that either rely entirely on
  off-chain data or would otherwise be too expensive to reasonably implement
  directly on-chain. ERC-721 holders may be rewarded with token claims based on
  evolving off-chain metadata, for instance.

  March 5th, 2022.
*/
contract ClaimableVault is
  EIP712, Ownable, ReentrancyGuard
{
  using SafeERC20 for IERC20;

  /// A constant hash of the mint operation's signature.
  bytes32 constant public CLAIM_TYPEHASH = keccak256(
    "claim(address _claimant,uint256 _amount,uint256 _limit,address _item,uint256 _id)"
  );

  /// The name of the vault.
  string public name;

  /// The address of the token given out for claims.
  address public immutable token;

  /// The address permitted to sign claim signatures.
  address public immutable signer;

  /**
    A double mapping to record the number of tokens claimed by a particular NFT,
    represented as an address and a token ID. The address of the NFT contract
    maps to the number of tokens claimed by each token ID of the NFT contract.
  */
  mapping ( address => mapping ( uint256 => uint256 )) claimed;

  /**
    An event emitted when a claimant claims tokens.

    @param timestamp The timestamp of the claim.
    @param claimant The caller who claimed the tokens.
    @param item The address of the ERC-721 contract involved in this claim.
    @param id The ID of the specific token within the ERC-721 `item` contract.
    @param amount The amount of tokens claimed.
  */
  event Claimed (
    uint256 timestamp,
    address indexed claimant,
    address indexed item,
    uint256 id,
    uint256 amount
  );

  /**
    Construct a new vault by providing it a permissioned claim signer which may
    issue claims and claim amounts.

    @param _name The name of the vault used in EIP-712 domain separation.
    @param _token The address of the ERC-20 token given out for claims.
    @param _signer The address permitted to sign claim signatures.
  */
  constructor (
    string memory _name,
    address _token,
    address _signer
  ) EIP712(_name, "1") {
    name = _name;
    token = _token;
    IERC20(token).approve(address(this), type(uint256).max);
    signer = _signer;
  }

  /**
    A private helper function to validate a signature supplied for token claims.
    This function constructs a digest and verifies that the signature signer was
    the authorized address we expect.

    @param _claimant The claimant attempting to claim tokens.
    @param _amount The amount of tokens the claimant is trying to claim.
    @param _limit The maximum number of tokens the `_item` could possibly claim. The claimant will be given the lesser of `_amount` or the difference between `_limit` and the total amount claimed by the specific item thus far.
    @param _item TODO
    @param _id TODO
    @param _v The recovery byte of the signature.
    @param _r Half of the ECDSA signature pair.
    @param _s Half of the ECDSA signature pair.
  */
  function validClaim (
    address _claimant,
    uint256 _amount,
    uint256 _limit,
    address _item,
    uint256 _id,
    uint8 _v,
    bytes32 _r,
    bytes32 _s
  ) private view returns (bool) {
    bytes32 digest = keccak256(
      abi.encodePacked(
        "\x19\x01",
        DOMAIN_SEPARATOR,
        keccak256(
          abi.encode(
            CLAIM_TYPEHASH,
            _claimant,
            _amount,
            _limit,
            _item,
            _id
          )
        )
      )
    );

    // The claim is validated if it was signed by our authorized signer.
    return ecrecover(digest, _v, _r, _s) == signer;
  }

  /**
    Allow a caller to claim any of their available tokens if
      1. the claim is backed by a valid signature from the trusuted `signer`.
      2. item `_id` has tokens that its holder may claim
      3. the caller is the holder of item `_id`
      4. the vault has enough tokens to fulfill the claim

    @param _amount The amount of tokens that the caller is trying to claim.
    @param _limit The maximum number of tokens the `_item` could possibly claim. The claimant will be given `_amount` tokens only if it is not greater than the difference between `_limit` and the total amount claimed by the specific item thus far.
    @param _item The ERC-721 item address of the item the caller is claiming.
    @param _id The token ID that the item caller is claiming for.
    @param _v The recovery byte of the signature.
    @param _r Half of the ECDSA signature pair.
    @param _s Half of the ECDSA signature pair.
  */
  function claim (
    uint256 _amount,
    uint256 _limit,
    address _item,
    uint256 _id,
    uint8 _v,
    bytes32 _r,
    bytes32 _s
  ) external {

    // Validiate that the claim was provided by our trusted `signer`.
    if (!validClaim(_msgSender(), _amount, _limit, _item, _id, _v, _r, _s)) {
      revert CannotClaimInvalidSignature();
    }

    // Prevent claiming tokens beyond the limit.
    if ((claimed[_item][_id] + _amount) > _limit) {
      revert CannotClaimBeyondAllocation();
    }

    /*
      We require that the caller is the holder of any items involved in this
      claim. While allowing a caller to pay the gas to claim tokens on behalf of
      items that the caller does not hold is not inherently an issue, it does
      present an avenue where the holder of an item may be prevented from
      allowing that item to transfer to a different address while bringing its
      token claim with it.
    */
    address holder = ITiny721(_item).ownerOf(_id);
    if (_msgSender() != holder) { revert CannotClaimForUnheldItem(); }

    // Update the amount claimed by the holder of this item.
    claimed[_item][_id] += _amount;

    // Transfer tokens to the item holder.
    IERC20(token).safeTransferFrom(
      address(this),
      holder,
      _amount
    );

    // Emit an event.
    emit Claimed(block.timestamp, _msgSender(), _item, _id, _amount);
  }

  /**
    Allow the owner to sweep either Ether or a particular ERC-20 token from the
    contract and send it to another address. This allows the owner of the shop
    to withdraw their funds after the sale is completed.

    @param _token The token to sweep the balance from; if a zero address is sent
      then the contract's balance of Ether will be swept.
    @param _amount The amount of token to sweep.
    @param _destination The address to send the swept tokens to.
  */
  function sweep (
    address _token,
    address _destination,
    uint256 _amount
  ) external onlyOwner nonReentrant {

    // A zero address means we should attempt to sweep Ether.
    if (_token == address(0)) {
      (bool success, ) = payable(_destination).call{ value: _amount }("");
      if (!success) { revert SweepingTransferFailed(); }

    // Otherwise, we should try to sweep an ERC-20 token.
    } else {
      IERC20(_token).safeTransfer(_destination, _amount);
    }
  }
}
