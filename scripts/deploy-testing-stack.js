'use strict';

// Imports.
import { ethers } from 'hardhat';
import * as fs from 'fs';
import HashTree from './HashTree';

// These are the constants for the item contract.
const ITEM_NAME = 'Test';
const ITEM_SYMBOL = 'TEST';
const METADATA_URI = 'https://impostors.s3.amazonaws.com/';
const CAP = 10420;

// These are the constants for the mock ERC-20 token.
const TOKEN_NAME = 'Mock';
const TOKEN_SYMBOL = 'M20';
const SUPPLY = ethers.utils.parseEther('1000000000');

// Prepare the whitelist.
let balances = [];
let recipients = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
  '0xaC337d0d330b683CfE8e6B5C62EB074e12bEB47C',
  '0xc685F930d07286D88E7Ea8cFdE8F9D4bEBBC8d5d',
  '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199',
  '0xbe4f0cdf3834bD876813A1037137DcFAD79AcD99'
];
for (let i = 0; i < recipients.length; i++) {
  balances[recipients[i].toLowerCase()] = 1;
}
let distribution = new HashTree(balances);

/*
  Export the generated whitelist hash trees to a file for inclusion in the
  frontend interface.
*/
let timestamp = Math.floor(Date.now() / 1000);
fs.writeFileSync(`./trees-${timestamp}.json`, JSON.stringify({
  trees: [ distribution.getTree() ]
}));

// These are the constants for the shop contract's whitelisted presale.
const NOW = Math.floor(Date.now() / 1000);
const TIME_UNTIL_PRESALE = 60 * 2;
const PRESALE_DURATION = 60 * 20;
const ETHER_PRESALE_ROOT = distribution.rootHash;
const TOKEN_PRESALE_ROOT = distribution.rootHash;
let PRESALE_TOKEN_ADDRESS;
const PRESALE_ETHER_PRICE = ethers.utils.parseEther('0.02');
const PRESALE_TOKEN_PRICE = ethers.utils.parseEther('5555');
const PRESALE_START_TIME = NOW + TIME_UNTIL_PRESALE;
const PRESALE_END_TIME = PRESALE_START_TIME + PRESALE_DURATION;

// These are the constants for the shop contract's public sale.
let ITEM_COLLECTION_ADDRESS;
const PUBLIC_START_TIME = PRESALE_END_TIME;
const PUBLIC_SALE_DURATION = 60 * 60 * 1;
const PUBLIC_END_TIME = PUBLIC_START_TIME + PUBLIC_SALE_DURATION;
const TOTAL_CAP = 10000;
const CALLER_CAP = 5;
const TRANSACTION_CAP = 2;
const STARTING_PRICE = ethers.utils.parseEther('0.03');
const ENDING_PRICE = ethers.utils.parseEther('0.01');
const TICK_DURATION = 60 * 1;
const TICK_AMOUNT = ethers.utils.parseEther('0.00003');

async function logTransactionGas(transaction) {
  let transactionReceipt = await transaction.wait();
  let transactionGasCost = transactionReceipt.gasUsed;
  console.log(` -> Gas cost: ${transactionGasCost.toString()}`);
  return transactionGasCost;
}

// Deploy using an Ethers signer to a network.
async function main() {
  const signers = await ethers.getSigners();
  const addresses = await Promise.all(
    signers.map(async signer => signer.getAddress())
  );
  const deployer = {
    provider: signers[0].provider,
    signer: signers[0],
    address: addresses[0]
  };
  console.log(`Deploying contracts from: ${deployer.address}`);

  // Retrieve the necessary contract factories.
  const Tiny721 = await ethers.getContractFactory('Tiny721');
  const MockERC20 = await ethers.getContractFactory('MockERC20');
  const DropAuctionShop721 = await ethers
    .getContractFactory('DropAuctionShop721');

  // Create a variable to track the total gas cost of deployment.
  let totalGasCost = ethers.utils.parseEther('0');

  // Deploy the testing Tiny721 item contract.
  let tiny721 = await Tiny721.connect(deployer.signer).deploy(
    ITEM_NAME,
    ITEM_SYMBOL,
    METADATA_URI,
    CAP
  );
  let tiny721Deployed = await tiny721.deployed();
  ITEM_COLLECTION_ADDRESS = tiny721.address;
  console.log('');
  console.log(`* Item collection deployed to: ${ITEM_COLLECTION_ADDRESS}`);
  totalGasCost = totalGasCost.add(
    await logTransactionGas(tiny721Deployed.deployTransaction)
  );

  // Log a verification command.
  console.log(`[VERIFY] npx hardhat verify --network rinkeby \
    ${ITEM_COLLECTION_ADDRESS} "${ITEM_NAME}" "${ITEM_SYMBOL}" \
    "${METADATA_URI}" ${CAP}`);

  // Deploy the testing ERC-20 token contract.
  let token = await MockERC20.connect(deployer.signer).deploy(
    TOKEN_NAME,
    TOKEN_SYMBOL,
    SUPPLY
  );
  let tokenDeployed = await token.deployed();
  PRESALE_TOKEN_ADDRESS = token.address;
  console.log('');
  console.log(`* Test presale token deployed to: ${PRESALE_TOKEN_ADDRESS}`);
  totalGasCost = totalGasCost.add(
    await logTransactionGas(tokenDeployed.deployTransaction)
  );

  // Log a verification command.
  console.log(`[VERIFY] npx hardhat verify --network rinkeby \
    ${PRESALE_TOKEN_ADDRESS} "${TOKEN_NAME}" "${TOKEN_SYMBOL}" ${SUPPLY}`);

  // Prepare configuration details for the item shop.
  let config = {
    startTime: PUBLIC_START_TIME,
    endTime: PUBLIC_END_TIME,
    totalCap: TOTAL_CAP,
    callerCap: CALLER_CAP,
    transactionCap: TRANSACTION_CAP,
    startingPrice: STARTING_PRICE,
    endingPrice: ENDING_PRICE,
    tickDuration: TICK_DURATION,
    tickAmount: TICK_AMOUNT
  };

  // Prepare configuration details for the ETH whitelist.
  let ethPresale = {
    root: ETHER_PRESALE_ROOT,
    startTime: PRESALE_START_TIME,
    endTime: PRESALE_END_TIME,
    price: PRESALE_ETHER_PRICE,
    token: ethers.constants.AddressZero
  };

  // Prepare configuration details for the token whitelist.
  let tokenPresale = {
    root: TOKEN_PRESALE_ROOT,
    startTime: PRESALE_START_TIME,
    endTime: PRESALE_END_TIME,
    price: PRESALE_TOKEN_PRICE,
    token: PRESALE_TOKEN_ADDRESS
  };

  // Deploy the item shop.
  let shop = await DropAuctionShop721.connect(deployer.signer).deploy(
    ITEM_COLLECTION_ADDRESS,
    config,
    [ ethPresale, tokenPresale ]
  );
  let shopDeployed = await shop.deployed();
  console.log('');
  console.log(`* Shop deployed to: ${shop.address}`);
  totalGasCost = totalGasCost.add(await logTransactionGas(shopDeployed.deployTransaction));

  /*
    For convenience when verifying the item shop contract, export a file
    containing the configuration details.
  */
  fs.writeFileSync('./shop.vars.json', JSON.stringify({
    address: ITEM_COLLECTION_ADDRESS,
    config: JSON.stringify(config),
    ethPresale: JSON.stringify(ethPresale),
    tokenPresale: JSON.stringify(tokenPresale)
  }));

  // Log a verification command.
  console.log(`[VERIFY] npx hardhat verify --network rinkeby \
    --constructor-args scripts/shop.args.js ${shop.address}`);

  // Set the shop as an administrator of the item contract.
  let setAdminTransaction = await tiny721.connect(deployer.signer)
    .setAdmin(shop.address, true);
  totalGasCost = totalGasCost.add(await logTransactionGas(setAdminTransaction));

  // Log the final gas cost of deployment.
  console.log('');
  console.log(`=> Final gas cost of deployment: ${totalGasCost.toString()}`);
}

// Execute the script and catch errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
