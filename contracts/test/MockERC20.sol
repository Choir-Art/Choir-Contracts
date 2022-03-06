// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
  @title A simple mock ERC-20 token contract for testing.
  @author Tim Clancy

  This simple ERC-20 contract supports a one-time mint event from the deployer.

  February 14th, 2022.
*/
contract MockERC20 is ERC20 {

  /**
    Construct a new testing ERC-20 token and mint a supply of said token to the
    deployer.

    @param _name The name of the new testing token.
    @param _symbol The ticker symbol of the new testing token.
    @param _supply The supply of this testing token, which will be minted
      entirely to the deployer.
  */
  constructor (
    string memory _name,
    string memory _symbol,
    uint256 _supply
  ) ERC20(_name, _symbol) {
    _mint(_msgSender(), _supply);
  }
}
