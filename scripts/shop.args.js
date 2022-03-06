'use strict';

// Imports.
import * as fs from 'fs';

// Parse shop configuration variables.
const vars = fs.readFileSync('./shop.vars.json', 'utf8');
const shopVars = JSON.parse(vars);
shopVars.config = JSON.parse(shopVars.config);
shopVars.ethPresale = JSON.parse(shopVars.ethPresale);
shopVars.tokenPresale = JSON.parse(shopVars.tokenPresale);

// Export the parse shop configuration for verification.
module.exports = [
  shopVars.address,
  shopVars.config,
  [ shopVars.ethPresale, shopVars.tokenPresale ]
];
