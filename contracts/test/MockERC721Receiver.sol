// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/**
  @title A mock ERC-721 token receiver for use in testing.
  @author Rostislav Khlebnikov
  @author Tim Clancy

  This contract is an ERC-721 token receiver and when asked via the
  `onERC721Received` function will signal itself as such, unless it has been
  constructed as specifically unable to receive ERC-721 tokens.

  February 9th, 2022.
*/
contract MockERC721Receiver is IERC721Receiver {

  /// Whether or not this contract can successfully receive ERC-721 tokens.
  bool public immutable canReceive;

  /**
    An event emitted when an ERC-721 token is successfully received by this
    receiver.

    @param caller The caller who triggered the ERC-721 transfer that is sending
      the token of ID `_id` to this contract.
    @param from The address that previously owned the token of ID `_id`.
    @param id The ID of the token being received.
    @param data Any additional data being passed with the transfer call.
  */
  event Received (
    address indexed caller,
    address indexed from,
    uint256 id,
    bytes data
  );

  /**
    An event emitted when an ERC-721 token is not successfully received by this
    receiver.
  */
  event NotReceived ();

  /**
    Construct a new instance of a mock ERC-721 token receiver.

    @param _canReceive A parameter indicating whether or not this contract can
      successfully receive ERC-721 tokens.
  */
  constructor (bool _canReceive) {
    canReceive = _canReceive;
  }

  /**
    Signal that this contract is able to safely receive ERC-721 items by
    returning implementing this function to return the magic value
    `bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"))`.

    @param _caller The caller who triggered the ERC-721 transfer that is sending
      the token of ID `_id` to this contract.
    @param _from The address that previously owned the token of ID `_id`.
    @param _id The ID of the token being received.
    @param _data Any additional data being passed with the transfer call.

    @return If this contract is configured as able to receive ERC-721 items,
    this will return the appropriate magic value to the caller. Otherwise, this
    will return garbage indicating that the contract cannot successfully receive
    ERC-721 items.
  */
  function onERC721Received (
    address _caller,
    address _from,
    uint256 _id,
    bytes calldata _data
  ) external override returns (bytes4) {
    if (canReceive) {
      emit Received(_caller, _from, _id, _data);
      return this.onERC721Received.selector;
    } else {
      emit NotReceived();
      return bytes4('00');
    }
  }
}
