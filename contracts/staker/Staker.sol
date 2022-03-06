// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/ITiny721.sol";

/*
  It saves bytecode to revert on custom errors instead of using require
  statements. We are just declaring these errors for reverting with upon various
  conditions later in this contract. Thanks, Chiru Labs!
*/
error CannotHaveEmptyEmissionSchedule();
error CannotCalculateEmissions();
error CannotAddPoolWithoutEmissionSchedule();
error CannotDepositInactivePool();
error CannotDepositUnownedToken();
error SweepingTransferFailed();

/**
  @title An simple staking contract for transfer-locking `Tiny721` items in
    exchange for tokens.
  @author Tim Clancy

  This staking contract disburses tokens from its internal reservoir according
  to a fixed emission schedule. Assets can be assigned varied staking weights.

  March 1st, 2022.
*/
contract Staker is
  Ownable, ReentrancyGuard
{
  using SafeERC20 for IERC20;

  /// The name of this Staker.
  string public name;

  /// The token to disburse.
  address public immutable token;

  /**
    This struct is used to define a token emission schedule for the Staker. Each
    `EmissionPoint` is one part of a broader emission schedule that relates a
    timestamp to the total number of tokens that are emitted each second.

    @param timestamp The timestamp when this point of the emission schedule
      activates.
    @param rate The number of tokens that are emitted each second beginning at
      `timestamp`.
  */
  struct EmissionPoint {
    uint256 timestamp;
    uint256 rate;
  }

  /**
    The number of token emission points that have been added. This is used for
    looking up specific emission point details from `tokenEmissionBlocks`.
  */
  uint256 public tokenEmissionBlockCount;

  /**
    A mapping to look up details about specific `EmissionPoint` entries in the
    token emission schedule.
  */
  mapping ( uint256 => EmissionPoint ) public tokenEmissionBlocks;

  /// We track the earliest possible emission timestamp for quick reference.
  uint256 private earliestTokenEmissionTime;

  /**
    This struct is used to define information regarding a particular pool that
    the user may choose to stake their NFT against.

    @param item The address of the item contract that is allowed to be staked in
      this pool.
    @param amount The number of specific items from the `item` contract that are
      staked in this pool.
    @param strength The relative token emission strength of this pool.
    @param tokensPerShare The accumulated tokens per share of this pool; this
      figure includes a scaling factor of 1e12. This figure is updated as users
      stake and unstake assets with this pool.
    @param lastRewardTime The last block timestamp where token distribution
      occurred. This is used to properly track user balances when staking.
  */
  struct Pool {
    address item;
    uint256 amount;
    uint256 strength;
    uint256 tokensPerShare;
    uint256 lastRewardTime;
  }

  /// A mapping with to look up information for each specific pool.
  mapping ( uint256 => Pool ) public pools;

  /**
    This struct is used to define information regarding a particular caller's
    position in a particular pool.

    @param amount The number of items that the caller has staked into a
      particular pool.
    @param tokenPaid The value of the caller's total earning that has been paid
      out in this position. This is used to track the pending reward due to this
      position.
  */
  struct Position {
    uint256 amount;
    uint256 tokenPaid;
  }

  /**
    A mapping from a particular `Pool` ID to a mapping of each caller's
    `Position` in that pool.
  */
  mapping ( uint256 => mapping ( address => Position )) public positions;

  /// The total sum of the strength of all `Pool`s in `pools`.
  uint256 public totalTokenStrength;

  /// The total amount of the disbursed `token` ever emitted by this Staker.
  uint256 public totalTokenDisbursed;

  // TODO
  // event Deposit(address indexed user, IERC20 indexed token, uint256 amount);
  // event Withdraw(address indexed user, IERC20 indexed token, uint256 amount);

  /**
    Construct a new Staker by providing it a name and the token to disburse.

    @param _name The name of the Staker contract.
    @param _token The token to reward stakers in this contract with.
  */
  constructor (
    string memory _name,
    address _token
  ) {
    name = _name;
    token = _token;
    earliestTokenEmissionTime = type(uint256).max;
  }

  /**
    Uses the emission schedule to calculate the total amount of staking reward
    token that was emitted between two specified timestamps.

    @param _from The time to begin calculating emissions from.
    @param _to The time to calculate total emissions up to.

    @return The total amount of `token` that was emitted by this Staker between
      `_from` and `_to`.
  */
  function getTotalEmittedTokens (
    uint256 _from,
    uint256 _to
  ) public view returns (uint256) {

    // Reject invalid emissions calculations.
    if (_to < _from) {
      revert CannotCalculateEmissions();
    }

    /*
      Iterate through the emission point schedule and compare the timestamp of
      each `EmissionPoint` against `_from` and `_to` to compute the number of
      emitted tokens given the rate at each point.
    */
    uint256 totalEmittedTokens = 0;
    uint256 workingRate = 0;
    uint256 workingTime = _from;
    for (uint256 i = 0; i < tokenEmissionBlockCount; i += 1) {
      uint256 emissionTime = tokenEmissionBlocks[i].timestamp;
      uint256 emissionRate = tokenEmissionBlocks[i].rate;

      // If this point is after `_to`, we may return with the prior rate.
      if (_to < emissionTime) {
        totalEmittedTokens += ((_to - workingTime) * workingRate);
        return totalEmittedTokens;

      // Otherwise, update our token emission and our working time.
      } else if (workingTime < emissionTime) {
        totalEmittedTokens += ((emissionTime - workingTime) * workingRate);
        workingTime = emissionTime;
      }

      // Update the working rate.
      workingRate = emissionRate;
    }

    // Count the final portion of the emission schedule and return.
    if (workingTime < _to) {
      totalEmittedTokens += ((_to - workingTime) * workingRate);
    }
    return totalEmittedTokens;
  }

  /**
    Set a new emission schedule for this Staker. This overwrites the old
    emission schedule.

    @param _schedule An array of `EmissionPoint`s defining the token
      emission schedule.
  */
  function setEmissions (
    EmissionPoint[] memory _schedule
  ) external onlyOwner {

    // An emission schedule must consist of at least one point.
    if (_schedule.length < 1) {
      revert CannotHaveEmptyEmissionSchedule();
    }

    // Set the new emission schedule.
    tokenEmissionBlockCount = _schedule.length;
    for (uint256 i = 0; i < tokenEmissionBlockCount; i++) {
      tokenEmissionBlocks[i] = _schedule[i];

      // Record the earliest token emission time for calculating earning rates.
      if (earliestTokenEmissionTime > _schedule[i].timestamp) {
        earliestTokenEmissionTime = _schedule[i].timestamp;
      }
    }
  }

  // TODO: minimum pool lock times.
  /**
    Allow the contract owner to add a new staking `Pool` to the Staker or
    overwrite the configuration of an existing one.

    @param _id The ID of the `Pool` to add or update.
    @param _strength The relative strength of this item pool in earning tokens.
    @param _item The address of the item contract that is staked in this pool.
  */
  function setPool (
    uint256 _id,
    uint256 _strength,
    address _item
  ) external onlyOwner {

    // Restrict owners from adding asset pools if there is no emission schedule.
    if (tokenEmissionBlockCount < 1) {
      revert CannotAddPoolWithoutEmissionSchedule();
    }

    // Find the time of the last token reward update.
    uint256 lastTokenRewardTime = block.timestamp > earliestTokenEmissionTime
      ? block.timestamp
      : earliestTokenEmissionTime;

    // Update the total token strength.
    totalTokenStrength = totalTokenStrength - pools[_id].strength + _strength;

    // Update the `Pool` being tracked in the `pools` mapping.
    pools[_id] = Pool({
      item: _item,
      amount: pools[_id].amount,
      strength: _strength,
      tokensPerShare: pools[_id].tokensPerShare,
      lastRewardTime: lastTokenRewardTime
    });
  }

  /**
    A private helper function to update the `Pool` corresponding to the
    specified pool ID.

    @param _id The ID of the pool to update position data for.
  */
  function _updatePool (
    uint256 _id
  ) private {

    // If the pool has already had its rewards updated, do nothing.
    if (block.timestamp <= pools[_id].lastRewardTime) {
      return;
    }

    /*
      If the pool has no items staked, flag its rewards as updated now and do
      nothing else.
    */
    if (pools[_id].amount < 1) {
      pools[_id].lastRewardTime = block.timestamp;
      return;
    }

    // Calculate token rewards for this pool.
    uint256 totalEmittedTokens = getTotalEmittedTokens(
      pools[_id].lastRewardTime,
      block.timestamp
    );
    uint256 tokensReward =
      totalEmittedTokens * pools[_id].strength / totalTokenStrength * 1e12;

    // Update the pool rewards per share to pay users the amount remaining.
    pools[_id].tokensPerShare = pools[_id].tokensPerShare
      + (tokensReward / pools[_id].amount);
    pools[_id].lastRewardTime = block.timestamp;
  }

  /**
    Lock some particular token IDs from some particular contract addresses into
    some particular `Pool` of this Staker.

    @param _poolId The ID of the `Pool` to stake items in.
    @param _tokenIds An array of token IDs corresponding to specific tokens in
      the item contract from `Pool` with the ID of `_poolId`.
  */
  function deposit (
    uint256 _poolId,
    uint256[] memory _tokenIds
  ) external nonReentrant {
    Pool storage pool = pools[_poolId];
    Position storage position = positions[_poolId][_msgSender()];

    // Reject deposits for inactive pools.
    if (pool.strength < 1) {
      revert CannotDepositInactivePool();
    }

    // Update the pool.
    _updatePool(_poolId);

    // If the caller has deposited assets, transfer their accrued balance to them.
    if (position.amount > 0) {
      uint256 reward =
        (position.amount * pool.tokensPerShare / 1e12) - position.tokenPaid;
      IERC20(token).safeTransferFrom(address(this), _msgSender(), reward);
      totalTokenDisbursed += reward;
    }

    // Deposit the caller's items by locking transfer of that item.
    ITiny721 item = ITiny721(pools[_poolId].item);
    for (uint256 i = 0; i < _tokenIds.length; i += 1) {
      uint256 tokenId = _tokenIds[i];

      /*
        Skip items that are already transfer locked. This is done to prevent the
        `amount` of items staked against this `Pool` from becoming larger than
        it should be in reality.
      */
      if (!item.transferLocks(tokenId)) {

        // Verify that the caller owns the token being locked.
        if (item.ownerOf(tokenId) != _msgSender()) {
          revert CannotDepositUnownedToken();
        }

        // Lock transfer and update the pool.
        item.lockTransfer(tokenId, true);
        pools[_poolId].amount += 1;
        position.amount += 1;
      }
    }

    // Update the count of tokens that have been paid to the caller's position.
    position.tokenPaid = position.amount * pool.tokensPerShare / 1e12;

    // TODO: events
    // emit Deposit(_msgSender(), _token, _amount);
  }

  /**
    Unlock some particular token IDs from some particular contract addresses
    from some particular `Pool` of this Staker.

    @param _poolId The ID of the `Pool` to unstake items from.
    @param _tokenIds An array of token IDs corresponding to specific tokens in
      the item contract from `Pool` with the ID of `_poolId` that are to be
      unstaked.
  */
  function withdraw (
    uint256 _poolId,
    uint256[] memory _tokenIds
  ) external nonReentrant {
    Pool storage pool = pools[_poolId];
    Position storage position = positions[_poolId][_msgSender()];

    // Update the pool.
    _updatePool(_poolId);

    /* uint256 pendingTokens = user.amount.mul(pool.tokensPerShare).div(1e12).sub(user.tokenPaid);
    token.safeTransferFrom(address(this), msg.sender, pendingTokens);
    totalTokenDisbursed = totalTokenDisbursed.add(pendingTokens);
    uint256 pendingPoints = user.amount.mul(pool.pointsPerShare).div(1e30).sub(user.pointPaid);
    userPoints[msg.sender] = userPoints[msg.sender].add(pendingPoints);
    if (address(_token) == address(token)) {
      totalTokenDeposited = totalTokenDeposited.sub(_amount);
    }
    user.amount = user.amount.sub(_amount);
    user.tokenPaid = user.amount.mul(pool.tokensPerShare).div(1e12);
    user.pointPaid = user.amount.mul(pool.pointsPerShare).div(1e30);
    pool.token.safeTransfer(address(msg.sender), _amount);
    emit Withdraw(msg.sender, _token, _amount); */
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
