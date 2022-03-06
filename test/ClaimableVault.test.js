'use strict';

// Imports.
import { ethers, network } from 'hardhat';
import { expect } from 'chai';
import 'chai/register-should';

describe('ClaimableVault', function () {
	let alice, bob, carol, dev;
	let SweepableToken, Tiny721, ClaimableVault;
	before(async () => {
		const signers = await ethers.getSigners();
		const addresses = await Promise.all(signers.map(async signer => signer.getAddress()));
		alice = { provider: signers[0].provider, signer: signers[0], address: addresses[0] };
		bob = { provider: signers[1].provider, signer: signers[1], address: addresses[1] };
		carol = { provider: signers[2].provider, signer: signers[2], address: addresses[2] };
		dev = { provider: signers[3].provider, signer: signers[3], address: addresses[3] };

    SweepableToken = await ethers.getContractFactory('SweepableToken');
    Tiny721 = await ethers.getContractFactory('Tiny721');
    ClaimableVault = await ethers.getContractFactory('ClaimableVault');
	});

  // Configuration details for the testing ERC-20 token.
	let TOKEN_NAME = 'Testing Token';
  let TOKEN_TICKER = 'TEST';
  let TOKEN_CAP = ethers.utils.parseEther('1000000000');
	let token, item, vault;

  // Configuration details for the testing Tiny721 item.
  const ITEM_NAME = 'Test Item';
  const ITEM_SYMBOL = 'TEST';
  const ITEM_METADATA_URI = '';
  const ITEM_CAP = 10000;

  // Configuration details for the testing vault.
  const VAULT_NAME = "Test Vault";

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
    vault = await ClaimableVault.connect(dev.signer).deploy(
      VAULT_NAME,
      token.address,
      dev.address
    );
    await vault.deployed();
	});

  // Perform those tests utilizing minted tokens.
  context('with minted items', async function() {
    beforeEach(async function() {

      // Send some tokens to the claiming vault.
      await token.connect(dev.signer).mint(
        vault.address,
        ethers.utils.parseEther('1000000')
      );

      // Mint an item to Alice.
      await item.connect(dev.signer).mint_Qgo(alice.address, 1);
    });

  	// Verify that item holders may claim tokens with valid signatures.
    describe('valid claiming', async function() {
    	it('allow a holder to claim', async () => {
    		const domain = {
    			name: VAULT_NAME,
    			version: "1",
    			chainId: network.config.chainId,
    			verifyingContract: vault.address
    		};

    		// Our signer can now sign the digest to produce an executable signature.
    		let signature = await dev.signer._signTypedData(
    			domain,
    			{
    				claim: [
    					{ name: '_claimant', type: 'address' },
    					{ name: '_amount', type: 'uint256' },
              { name: '_limit', type: 'uint256' },
              { name: '_item', type: 'address' },
              { name: '_id', type: 'uint256' }
    				]
    			},
    			{
    				'_claimant': alice.address,
    				'_amount': ethers.utils.parseEther('1000'),
            '_limit': ethers.utils.parseEther('1000'),
            '_item': item.address,
            '_id': 1
    			}
    		);
    		let { v, r, s } = ethers.utils.splitSignature(signature);

    		// Alice should be able to execute this signature.
    		let aliceBalance = await token.balanceOf(alice.address);
    		aliceBalance.should.be.equal(0);
    		await vault.connect(alice.signer).claim(
    			ethers.utils.parseEther('1000'),
          ethers.utils.parseEther('1000'),
          item.address,
          1,
          v, r, s
        );
    		aliceBalance = await token.balanceOf(alice.address);
    		aliceBalance.should.be.equal(ethers.utils.parseEther('1000'));
    	});
    });
  });
});
