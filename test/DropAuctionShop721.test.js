'use strict';

// Imports.
import { ethers, network } from 'hardhat';
import { expect } from 'chai';
import 'chai/register-should';
import HashTree from '../scripts/HashTree';

/**
  Describe the contract testing suite, retrieve testing wallets, and create
  contract factories from the artifacts we are testing.
*/
describe('DropAuctionShop721', function () {
  let alice, bob, carol, dev;
  let Tiny721, MockERC20, DropAuctionShop721;
  before(async () => {
    const signers = await ethers.getSigners();
    const addresses = await Promise.all(signers.map(async signer => signer.getAddress()));
    alice = { provider: signers[0].provider, signer: signers[0], address: addresses[0] };
    bob = { provider: signers[1].provider, signer: signers[1], address: addresses[1] };
    carol = { provider: signers[2].provider, signer: signers[2], address: addresses[2] };
    dev = { provider: signers[3].provider, signer: signers[3], address: addresses[3] };

    Tiny721 = await ethers.getContractFactory('Tiny721');
    MockERC20 = await ethers.getContractFactory('MockERC20');
    DropAuctionShop721 = await ethers.getContractFactory('DropAuctionShop721');
  });

  // Deploy a fresh set of smart contracts, using these constants, for testing.
  // These are the constants for the item contract.
  const ITEM_NAME = 'Test';
  const ITEM_SYMBOL = 'TEST';
  const METADATA_URI = '';
  const CAP = 10420;

  // These are the constants for the mock ERC-20 token.
  const TOKEN_NAME = 'Mock';
  const TOKEN_SYMBOL = 'M20';
  const SUPPLY = ethers.utils.parseEther('1000000000');

  // These are the constants for the shop contract's whitelisted presale.
  const NOW = Math.floor(Date.now() / 1000);
  const TIME_UNTIL_PRESALE = 60 * 60;
  const PRESALE_DURATION = 60 * 60 * 2;
  let ETHER_PRESALE_ROOT;
  let TOKEN_PRESALE_ROOT;
  let PRESALE_TOKEN_ADDRESS;
  const PRESALE_ETHER_PRICE = ethers.utils.parseEther('1');
  const PRESALE_TOKEN_PRICE = ethers.utils.parseEther('5555');
  const PRESALE_START_TIME = NOW + TIME_UNTIL_PRESALE;
  const PRESALE_END_TIME = PRESALE_START_TIME + PRESALE_DURATION;

  // These are the constants for the shop contract's public sale.
  let ITEM_COLLECTION_ADDRESS;
  const PUBLIC_START_TIME = PRESALE_END_TIME;
  const PUBLIC_SALE_DURATION = 60 * 60 * 2;
  const PUBLIC_END_TIME = PUBLIC_START_TIME + PUBLIC_SALE_DURATION;
  const TOTAL_CAP = 10000;
  const CALLER_CAP = 5;
  const TRANSACTION_CAP = 2;
  const STARTING_PRICE = ethers.utils.parseEther('2');
  const ENDING_PRICE = ethers.utils.parseEther('1');
  const TICK_DURATION = 60 * 15;
  const TICK_AMOUNT = ethers.utils.parseEther('0.01');
  let tiny721, token, shop, distribution;
  beforeEach(async () => {

    // Construct a hash tree for the whitelists.
    let balances = { };
    let recipients = [
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
      '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
      alice.address,
      bob.address
    ];
    for (let i = 0; i < recipients.length; i++) {
      balances[recipients[i].toLowerCase()] = 1;
    }
    distribution = new HashTree(balances);

    // Store the root hash of the whitelist.
    ETHER_PRESALE_ROOT = distribution.rootHash;
    TOKEN_PRESALE_ROOT = distribution.rootHash;

    // Deploy an instance of the Tiny721 ERC-721 item contract.
    tiny721 = await Tiny721.connect(alice.signer).deploy(
      ITEM_NAME,
      ITEM_SYMBOL,
      METADATA_URI,
      CAP
    );
    await tiny721.deployed();
    ITEM_COLLECTION_ADDRESS = tiny721.address;

    // Deploy the testing ERC-20 token contract.
    token = await MockERC20.connect(alice.signer).deploy(
      TOKEN_NAME,
      TOKEN_SYMBOL,
      SUPPLY
    );
    await token.deployed();
    PRESALE_TOKEN_ADDRESS = token.address;

    // Give tokens to Bob and Carol.
    await token.connect(alice.signer).transfer(bob.address,
      ethers.utils.parseEther('1000000'));
    await token.connect(alice.signer).transfer(carol.address,
      ethers.utils.parseEther('1000000'))

    // Deploy a drop shop contract for selling the Tiny721 items.
    shop = await DropAuctionShop721.connect(alice.signer).deploy(
      ITEM_COLLECTION_ADDRESS,

      // Specify public sale configuration data.
      {
        startTime: PUBLIC_START_TIME,
        endTime: PUBLIC_END_TIME,
        totalCap: TOTAL_CAP,
        callerCap: CALLER_CAP,
        transactionCap: TRANSACTION_CAP,
        startingPrice: STARTING_PRICE,
        endingPrice: ENDING_PRICE,
        tickDuration: TICK_DURATION,
        tickAmount: TICK_AMOUNT
      },

      // Specify presale whitelists.
      [
        {
          root: ETHER_PRESALE_ROOT,
          startTime: PRESALE_START_TIME,
          endTime: PRESALE_END_TIME,
          price: PRESALE_ETHER_PRICE,
          token: ethers.constants.AddressZero
        },
        {
          root: TOKEN_PRESALE_ROOT,
          startTime: PRESALE_START_TIME,
          endTime: PRESALE_END_TIME,
          price: PRESALE_TOKEN_PRICE,
          token: PRESALE_TOKEN_ADDRESS
        }
      ]
    );
    await shop.deployed();

    // Make the mint shop an admin for the item.
    await tiny721.connect(alice.signer).setAdmin(shop.address, true);
  });

  // Perform tests during the whitelisted presale.
  context('during the whitelist sale', async function () {
    before(async function() {
      await ethers.provider.send('evm_setNextBlockTimestamp', [
        PRESALE_START_TIME
      ]);
      await ethers.provider.send('evm_mine');
    });

    // Attempt to purchase an item during the presale.
    it('should not allow non-whitelist callers to buy an item for ether',
      async function () {
      let bobBalance = await tiny721.connect(alice.signer)
        .balanceOf(bob.address);
      bobBalance.should.be.equal(0);
      let carolBalance = await tiny721.connect(alice.signer)
        .balanceOf(carol.address);
      carolBalance.should.be.equal(0);

      // Generate an invalid proof.
      let zeroLeaf = ethers.utils.solidityKeccak256(
        [ 'uint256', 'address', 'uint256' ],
        [ 1, ethers.constants.AddressZero, 0 ]
      );

      /*
        Bob is part of the whitelist but should still be rejected for submitting
        an invalid proof.
      */
      await expect(
        shop.connect(bob.signer).mint(1, {
          id: 0,
          index: 1,
          allowance: 1,
          proof: [ zeroLeaf, zeroLeaf, zeroLeaf ]
        }, {
          value: ethers.utils.parseEther('1')
        })
      ).to.be.revertedWith('CannotVerifyAsWhitelistMember()');

      // Carol is not part of the whitelist and should also be rejected.
      await expect(shop.connect(carol.signer).mint(1, {
        id: 0,
        index: 1,
        allowance: 1,
        proof: [ zeroLeaf, zeroLeaf, zeroLeaf ]
      }, {
        value: ethers.utils.parseEther('1')
      })).to.be.revertedWith('CannotVerifyAsWhitelistMember()');

      // Ensure that no tokens were minted during the invalid whitelist calls.
      bobBalance = await tiny721.connect(alice.signer)
        .balanceOf(bob.address);
      carolBalance = await tiny721.connect(alice.signer)
        .balanceOf(carol.address);
      bobBalance.should.be.equal(0);
      carolBalance.should.be.equal(0);
    });

    // Attempt to purchase an item during the presale.
    it('should allow whitelist caller to buy an item for ether',
      async function () {
      let bobBalance = await tiny721.connect(alice.signer)
        .balanceOf(bob.address);
      bobBalance.should.be.equal(0);

      // Retrieve Bob's proof from the hash tree.
      let callerIndex = distribution.getIndex(bob.address);
      let callerProof = distribution.getProof(callerIndex)

      // Bob attempts to purchase an item.
      shop.connect(bob.signer).mint(1, {
        id: 0,
        index: callerIndex,
        allowance: 1,
        proof: callerProof
      }, {
        value: ethers.utils.parseEther('1')
      });

      // Bob should have his token.
      bobBalance = await tiny721.connect(alice.signer)
        .balanceOf(bob.address);
      bobBalance.should.be.equal(1);
    });

    // Attempt to purchase an item during the presale using tokens.
    it('should allow whitelist caller to buy an item for tokens',
    async function () {
      let bobBalance = await tiny721.connect(alice.signer)
        .balanceOf(bob.address);
      bobBalance.should.be.equal(0);

      // Bob must approve the shop to spend tokens before he may spend tokens.
      let approvalTransaction = await token.connect(bob.signer).approve(
        shop.address,
        ethers.constants.MaxUint256
      );

      // Submit Bob's whitelist proof for purchasing with tokens.
      let callerIndex = distribution.getIndex(bob.address);
      let callerProof = distribution.getProof(callerIndex)
      shop.connect(bob.signer).mint(1, {
        id: 1,
        index: callerIndex,
        allowance: 1,
        proof: callerProof
      });

      // Ensure that Bob got his item.
      bobBalance = await tiny721.connect(alice.signer)
        .balanceOf(bob.address);
      bobBalance.should.be.equal(1);
    });
  });

  // Perform tests during the public sale.
  context('during the public sale', async function() {
    before(async function() {
      await ethers.provider.send('evm_setNextBlockTimestamp', [
        PUBLIC_START_TIME
      ]);
      await ethers.provider.send('evm_mine');
    });

    // Attempt to purchase an item during the public sale as a non-presaler.
    it('allows non-whitelist caller to buy an item for ether',
    async function () {
      let carolBalance = await tiny721.connect(alice.signer)
        .balanceOf(carol.address);
      carolBalance.should.be.equal(0);

      // Create a null proof for a public sale to submit.
      let nullProof = {
        id: 0,
        index: 0,
        allowance: 0,
        proof: [ ]
      };

      // Carol will attempt to buy an item.
      await shop.connect(carol.signer).mint(1, nullProof, {
        value: ethers.utils.parseEther('2')
      });

      // Ensure that Carol received her item.
      carolBalance = await tiny721.connect(alice.signer)
        .balanceOf(carol.address);
      carolBalance.should.be.equal(1);
    });

    // Attempt to purchase an item during the public sale as a presale caller.
    it('allows whitelist caller to buy an item for ether', async function() {
      let bobBalance = await tiny721.connect(alice.signer)
        .balanceOf(bob.address);
      bobBalance.should.be.equal(0);

      // Create a null proof for a public sale to submit.
      let nullProof = {
        id: 0,
        index: 0,
        allowance: 0,
        proof: [ ]
      };

      // Bob will attempt to buy an item.
      await shop.connect(bob.signer).mint(1, nullProof, {
        value: ethers.utils.parseEther('2')
      });

      // Ensure that Bob received his item.
      bobBalance = await tiny721.connect(alice.signer)
        .balanceOf(bob.address);
      bobBalance.should.be.equal(1);
    });

    // Purchases that are short on ETH should fail.
    it('should fail if payment is < current price', async function() {
      let bobBalance = await tiny721.connect(alice.signer)
        .balanceOf(bob.address);
      bobBalance.should.be.equal(0);

      // Create a null proof for a public sale to submit.
      let nullProof = {
        id: 0,
        index: 0,
        allowance: 0,
        proof: [ ]
      };

      // Bob will attempt to buy an item.
      await expect(
        shop.connect(bob.signer).mint(1, nullProof, {
          value: ethers.utils.parseEther('1')
        })
      ).to.be.revertedWith('CannotUnderpayForMint()');

      // Ensure that Bob received no item.
      bobBalance = await tiny721.connect(alice.signer)
        .balanceOf(bob.address);
      bobBalance.should.be.equal(0);
    });
  });
});
