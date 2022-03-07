'use strict';

// Imports.
import { ethers, network } from 'hardhat';
import { expect } from 'chai';
import 'chai/register-should';

describe('ClaimableMint', function () {
	let alice, bob, carol, dev;
	let SweepableToken, Tiny721, ClaimableMint;
	before(async () => {
		const signers = await ethers.getSigners();
		const addresses = await Promise.all(signers.map(async signer => signer.getAddress()));
		alice = { provider: signers[0].provider, signer: signers[0], address: addresses[0] };
		bob = { provider: signers[1].provider, signer: signers[1], address: addresses[1] };
		carol = { provider: signers[2].provider, signer: signers[2], address: addresses[2] };
		dev = { provider: signers[3].provider, signer: signers[3], address: addresses[3] };

    SweepableToken = await ethers.getContractFactory('SweepableToken');
    Tiny721 = await ethers.getContractFactory('Tiny721');
    ClaimableMint = await ethers.getContractFactory('ClaimableMint');
	});

  // Configuration details for the testing ERC-20 token.
	let TOKEN_NAME = 'Testing Token';
  let TOKEN_TICKER = 'TEST';
  let TOKEN_CAP = ethers.utils.parseEther('1000000000');
	let token, item, minter;

  // Configuration details for the testing Tiny721 item.
  const ITEM_NAME = 'Test Item';
  const ITEM_SYMBOL = 'TEST';
  const ITEM_METADATA_URI = '';
  const ITEM_CAP = ethers.constants.MaxUint256;

  // Configuration details for the testing minter.
  const MINTER_NAME = 'Test Minter';

	// Deploy a fresh set of smart contracts for testing with.
	beforeEach(async () => {
		token = await SweepableToken.connect(dev.signer).deploy(
			TOKEN_NAME,
			TOKEN_TICKER,
      TOKEN_CAP
		);
		await token.deployed();
    item = await Tiny721.connect(dev.signer).deploy(
      ITEM_NAME,
      ITEM_SYMBOL,
      ITEM_METADATA_URI,
      ITEM_CAP
    );
    await item.deployed();
    minter = await ClaimableMint.connect(dev.signer).deploy(
      MINTER_NAME,
      dev.address,
			token.address,
			item.address,
			carol.address
    );
    await minter.deployed();
	});

  // Perform those tests utilizing minted tokens.
  context('with minted items', async function() {
    beforeEach(async function() {

      // Send some tokens to Alice.
      await token.connect(dev.signer).mint(
        alice.address,
        ethers.utils.parseEther('1000000')
      );

			// Alice should approve the minter to spend her tokens.
			await token.connect(alice.signer).approve(
				minter.address,
				ethers.constants.MaxUint256
			);

      // Approve the claim minter as an admin for minting `item`.
			await item.connect(dev.signer).setAdmin(minter.address, true);
    });

  	// Verify that callers may mint items with valid signatures.
    describe('valid minting', async function() {
    	it('allow a caller to pay to mint', async () => {
    		const domain = {
    			name: MINTER_NAME,
    			version: '1',
    			chainId: network.config.chainId,
    			verifyingContract: minter.address
    		};

    		// Our signer can sign the digest to produce an executable signature.
    		let signature = await dev.signer._signTypedData(
    			domain,
    			{
    				mint: [
    					{ name: '_minter', type: 'address' },
    					{ name: '_cost', type: 'uint256' },
              { name: '_offchainId', type: 'uint256' }
    				]
    			},
    			{
    				'_minter': alice.address,
            '_cost': ethers.utils.parseEther('1000'),
            '_offchainId': 1
    			}
    		);
    		let { v, r, s } = ethers.utils.splitSignature(signature);

    		// Alice should be able to execute this signature.
    		let aliceBalance = await item.balanceOf(alice.address);
    		aliceBalance.should.be.equal(0);
    		await minter.connect(alice.signer).mint(
    			ethers.utils.parseEther('1000'),
          1,
          v, r, s
        );
    		aliceBalance = await item.balanceOf(alice.address);
    		aliceBalance.should.be.equal(1);
    	});
    });
  });
});
