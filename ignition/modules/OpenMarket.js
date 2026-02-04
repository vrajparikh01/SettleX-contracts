const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("OpenMarket", (m) => {

  const OpenMarket = m.contract("OpenMarket");

  return { OpenMarket };
});
