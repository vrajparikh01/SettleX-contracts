const { expect } = require("chai");
const { ethers } = require("hardhat");

function tokens(n) {
    return ethers.parseEther(n.toString());
}

describe("PreMarket", async ()=> {
    let preMarket;
    let deployer, addr1, addr2, addr3;
    let offerToken, stableToken, collateralToken;
    let offer, offer1, offerId, offerId1;

    before(async () => {
        [deployer, addr1, addr2, addr3] = await ethers.getSigners();

        offerToken = await ethers.deployContract("TestToken", ["Offer Token", "OFFER"]);
        console.log("Offer Token deployed to:", offerToken.target);
        stableToken = await ethers.deployContract("TestToken", ["Receive Token", "RECEIVE"]);
        console.log("Receive Token deployed to:", stableToken.target);
        collateralToken = await ethers.deployContract("TestToken", ["Collateral Token", "COLLATERAL"]);
        console.log("Collateral Token deployed to:", collateralToken.target);

        preMarket = await ethers.deployContract("PreMarket");

        // mint offer and receive tokens to the users
        offerToken.connect(deployer).mint(addr1.address, tokens(1000));
        offerToken.connect(deployer).mint(addr2.address, tokens(1000));
        stableToken.connect(deployer).mint(addr1.address, tokens(1000));
        stableToken.connect(deployer).mint(addr2.address, tokens(1000));
        collateralToken.connect(deployer).mint(addr1.address, tokens(1000));
        collateralToken.connect(deployer).mint(addr2.address, tokens(1000));

        offer = {
            offerType: 1,
            OfferToken: offerToken.target,
            OfferTokenAmount: tokens(100),
            StableToken: stableToken.target,
            StableTokenAmount: tokens(200),
            CollateralToken: collateralToken.target,
            CollateralTokenAmount: tokens(100),
            creator: addr1.address,
            amtSold: 0
        }

        offer1 = {
            offerType: 0,
            OfferToken: offerToken.target,
            OfferTokenAmount: tokens(100),
            StableToken: stableToken.target,
            StableTokenAmount: tokens(200),
            CollateralToken: collateralToken.target,
            CollateralTokenAmount: tokens(100),
            creator: addr1.address,
            amtSold: 0
        }

        await preMarket.addToken(offerToken.target, Math.ceil(Date.now()/1000) + 1000, Math.ceil(Date.now()/1000) + 50000);
    });

    it("should allow owner to set the commission", async () => {
        await preMarket.connect(deployer).setCommission(25, 10);
        let commissions = await preMarket.getCommissionPercentage();
        expect(commissions[0]).to.equal(25);
        expect(commissions[1]).to.equal(10);
    });

    it("should not allow other users to set the commission", async () => {
        await expect(preMarket.connect(addr1).setCommission(25, 100)).to.be.reverted
    });

    it("should allow users to create an offer", async () => {
        await offerToken.connect(addr1).approve(preMarket.target, tokens(100));
        await collateralToken.connect(addr1).approve(preMarket.target, tokens(100));

        let prevBalCollateral = await collateralToken.balanceOf(addr1.address);
        console.log("prevBalCollateral", prevBalCollateral.toString());

        let prevBalContract = await collateralToken.balanceOf(preMarket.target);
        console.log("prevBalContract", prevBalContract.toString());

        let tx = await preMarket.connect(addr1).createOffer(offer);
        let receipt = await tx.wait();

        await expect(receipt).to.emit(preMarket, "OfferCreated").withArgs(0, addr1.address);
        offerId = 0;

        let afterBalCollateral = await collateralToken.balanceOf(addr1.address);
        console.log("afterBalCollateral", afterBalCollateral.toString());

        let afterBalContract = await collateralToken.balanceOf(preMarket.target);
        console.log("afterBalContract", afterBalContract.toString());

        expect(afterBalCollateral).to.equal(prevBalCollateral - offer.CollateralTokenAmount);
        expect(afterBalContract).to.equal(prevBalContract + offer.CollateralTokenAmount);

        let offerDetail = await preMarket.getOfferDetails(offerId);
        expect(offerDetail.OfferTokenAmount).to.equal(offer.OfferTokenAmount);
        expect(offerDetail.OfferToken).to.equal(offer.OfferToken);
        expect(offerDetail.creator).to.equal(offer.creator);
    });

    it("should allow deployer to change timestamps", async () => {
        await preMarket.connect(deployer).editTimestamps(offer.OfferToken, Math.ceil(Date.now()/1000) + 1000, Math.ceil(Date.now()/1000) + 50000);

        // check if the timestamps are changed
        let tokenDetails = await preMarket.getTokenDetails(offerToken.target);
        expect(tokenDetails.tgeStart).to.equal(Math.ceil(Date.now()/1000) + 1000);
        expect(tokenDetails.tgeEnd).to.equal(Math.ceil(Date.now()/1000) + 50000);
    });

    it("should not allow other users to change timestamps", async () => {
        await expect(preMarket.connect(addr2).editTimestamps(offer.OfferToken, Math.ceil(Date.now()/1000) + 1000, Math.ceil(Date.now()/1000) + 50000)).to.be.reverted;
    });

    it("should allow user to contribute to an offer", async () => {
        let prevBalStable = await stableToken.balanceOf(addr2.address);
        console.log("prevBalStable", prevBalStable.toString());

        let prevBalDeployer = await stableToken.balanceOf(deployer.address);
        console.log("prevBalDeployer", prevBalDeployer.toString());

        await stableToken.connect(addr2).approve(preMarket.target, tokens(200));

        let tx = await preMarket.connect(addr2).contributeToOffer(offerId, tokens(20), tokens(10));
        let receipt = await tx.wait();

        await expect(receipt).to.emit(preMarket, "OfferContribution").withArgs(offerId, addr2.address, tokens(20));

        let afterBalStable = await stableToken.balanceOf(addr2.address);
        console.log("afterBalStable", afterBalStable.toString());

        let afterBalDeployer = await stableToken.balanceOf(deployer.address);
        console.log("afterBalDeployer", afterBalDeployer.toString());

        let commissions = await preMarket.getCommissionPercentage();
        let commissionAmount = (tokens(20).toString() * commissions[0].toString() / commissions[1].toString())/100;
        commissionAmount = commissionAmount.toString();

        let offerDetail = await preMarket.getOfferDetails(offerId);
        expect(offerDetail.amtSold).to.equal(tokens(10));
        expect(afterBalStable).to.equal(prevBalStable - tokens(20));
        expect(afterBalDeployer).to.equal(prevBalDeployer + BigInt(commissionAmount));
    });

    it("should not allow users to contribute to an offer if TGE already achieved", async () => {
        const currentTimeInSeconds = Math.ceil(Date.now() / 1000);
        const futureStartTimestamp = currentTimeInSeconds - 10000000; 
        const endTimestamp = futureStartTimestamp + 100000000; 

        await preMarket.connect(deployer).editTimestamps(offer.OfferToken, futureStartTimestamp, endTimestamp);
    
        await expect(preMarket.connect(addr2).contributeToOffer(offerId, tokens(20), tokens(10))).to.be.revertedWith("TGE already passed, you can't contribute now");

        await preMarket.connect(deployer).editTimestamps(offer.OfferToken, Math.ceil(Date.now()/1000) + 1000, Math.ceil(Date.now()/1000) + 50000);
    });
    
    it("should not allow users to contribute to an offer with invalid amounts", async () => {
        await expect(preMarket.connect(addr2).contributeToOffer(offerId, 0, tokens(10))).to.be.revertedWith("Contribution amount must be greater than zero");
    });

    it("should not allow users to contribute to an offer with more than available tokens", async () => {
        let offerDetail = await preMarket.getOfferDetails(offerId);
        console.log(offerDetail)

        await expect(preMarket.connect(addr2).contributeToOffer(offerId, tokens(20), tokens(1000))).to.be.revertedWith("Not enough tokens left in offer");
    });
    
    it("should not allow to distribute tokens if TGE hasn't reached", async () => {
        await expect(preMarket.connect(addr1).distributeTokensSell(offerId)).to.be.revertedWith("TGE not reached yet");
    });

    it("should not allow other users to distribute tokens", async () => {
        await preMarket.connect(deployer).editTimestamps(offer.OfferToken, Math.ceil(Date.now()/1000) - 700000, Math.ceil(Date.now()/1000) + 600000);

        await expect(preMarket.connect(addr2).distributeTokensSell(offerId)).to.be.revertedWith("Only the offer creator can distribute tokens");
    });

    it("should allow offer creator to distribute tokens", async () => {
        let prevUserBal = await offerToken.balanceOf(addr2.address);
        console.log("prevUserBal", prevUserBal.toString());

        let prevCreatorBal = await stableToken.balanceOf(offer.creator);
        console.log("prevCreatorBal", prevCreatorBal.toString());

        let tx = await preMarket.connect(addr1).distributeTokensSell(offerId);
        let receipt = await tx.wait();

        await expect(receipt).to.emit(preMarket, "TokensDistributed").withArgs(offerId, addr1.address);

        let offerDetail = await preMarket.getOfferDetails(offerId);

        let afterUserBal = await offerToken.balanceOf(addr2.address);
        console.log("afterUserBal", afterUserBal.toString());

        let afterCreatorBal = await stableToken.balanceOf(offer.creator);
        console.log("afterCreatorBal", afterCreatorBal.toString());

        let commissions = await preMarket.getCommissionPercentage();
        let receiveAmount = tokens(20).toString() - ((tokens(20).toString() * commissions[0].toString() / commissions[1].toString())/100);
        receiveAmount = receiveAmount.toString();
        console.log("receiveAmount", receiveAmount);

        expect(afterUserBal).to.equal((prevUserBal) + offerDetail.amtSold);
        expect(afterCreatorBal).to.equal(BigInt(Number(prevCreatorBal) + Number(receiveAmount)));
    });

    it("should not allow to distribute collateral tokens if TGE end time is passed", async () => {
        await expect(preMarket.connect(addr2).distributeAfter24HoursSell(offerId, addr2.address)).to.be.revertedWith("TGE settle end time hasn't passed yet");
    });

    // it("should allow offer creator to distribute collateral tokens after 24 hrs of TGE", async () => {
    //     // set the time to 24 hours after TGE
    //     await preMarket.connect(deployer).editTimestamps(offer.OfferToken, Math.ceil(Date.now()/1000) - 96600, Math.ceil(Date.now()/1000) - 96400);

    //     let prevCreatorBal = await collateralToken.balanceOf(addr2.address);
    //     console.log("prevCreatorBal collateral", prevCreatorBal.toString());

    //     let prevCreatorBal1 = await stableToken.balanceOf(addr2.address);
    //     console.log("prevCreatorBal1 stable", prevCreatorBal1.toString());

    //     let prevBalDeployer = await collateralToken.balanceOf(deployer.address);
    //     console.log("prevBalDeployer collateral", prevBalDeployer.toString());

    //     let tx = await preMarket.connect(addr2).distributeAfter24HoursSell(offerId, addr2.address);
    //     let receipt = await tx.wait();

    //     await expect(receipt).to.emit(preMarket, "CollateralTokensDistributed").withArgs(offerId, addr2.address);

    //     let offerDetail = await preMarket.getOfferDetails(offerId);

    //     let afterCreatorBal = await collateralToken.balanceOf(addr2.address);
    //     console.log("afterCreatorBal collateral", afterCreatorBal.toString());

    //     let afterCreatorBal1 = await stableToken.balanceOf(addr2.address);
    //     console.log("afterCreatorBal1 stable", afterCreatorBal1.toString());

    //     let afterBalDeployer = await collateralToken.balanceOf(deployer.address);
    //     console.log("afterBalDeployer collateral", afterBalDeployer.toString());

    //     let commissions = await preMarket.getCommissionPercentage();
    //     let commissionAmount = (tokens(20).toString() * commissions[0].toString() / commissions[1].toString())/100;
    //     let receiveAmount = tokens(20).toString() - commissionAmount;
    //     receiveAmount = receiveAmount.toString();

    //     expect(afterCreatorBal).to.equal(BigInt(Number(prevCreatorBal) + Number(receiveAmount)));
    //     expect(afterCreatorBal1).to.equal(BigInt(Number(prevCreatorBal1) + Number(receiveAmount)));
    //     expect(afterBalDeployer).to.equal(BigInt(Number(prevBalDeployer) + Number(commissionAmount)));
    // });

    it("should get the user offers", async () => {
        let index = await preMarket.getLastAddedOfferIndex(addr1.address);
        let userOffers = await preMarket.getUserOffers(addr1.address);
        // console.log(userOffers);
        expect(userOffers.length - 1).to.equal(index);
    });

    it.skip("create a new offer1 of offer type BUY and check the whole flow", async() => {
        // set commission
        await preMarket.connect(deployer).setCommission(25, 10);

        // create offer
        console.log("-------Creating offer1-------");
        await stableToken.connect(addr1).approve(preMarket.target, tokens(200));

        let prevBalStable = await stableToken.balanceOf(addr1.address);
        console.log("prevBalStable stable", ethers.formatEther(prevBalStable.toString()));

        let prevBalDeployer = await stableToken.balanceOf(deployer.address);
        console.log("prevBalDeployer stable", ethers.formatEther(prevBalDeployer.toString()));

        let tx = await preMarket.connect(addr1).createOffer(offer1);
        let receipt = await tx.wait();

        await expect(receipt).to.emit(preMarket, "OfferCreated").withArgs(0, addr1.address);
        offerId1 = 0;

        let afterBalStable = await stableToken.balanceOf(addr1.address);
        console.log("afterBalStable stable", ethers.formatEther(afterBalStable.toString()));

        let afterBalDeployer = await stableToken.balanceOf(deployer.address);
        console.log("afterBalDeployer stable", ethers.formatEther(afterBalDeployer.toString()));

        let commissions = await preMarket.getCommissionPercentage();
        let commissionAmount = (offer1.StableTokenAmount.toString() * commissions[0].toString() / commissions[1].toString())/100;
        commissionAmount = commissionAmount.toString();

        expect(afterBalStable).to.equal(prevBalStable - offer1.StableTokenAmount);
        expect(afterBalDeployer).to.equal(prevBalDeployer + BigInt(commissionAmount));

        let offerDetail = await preMarket.getOfferDetails(offerId1);
        expect(offerDetail.OfferTokenAmount).to.equal(offer1.OfferTokenAmount);
        expect(offerDetail.OfferToken).to.equal(offer1.OfferToken);
        expect(offerDetail.creator).to.equal(offer1.creator);

        // contribute to the offer
        console.log("------Contributing to offer1-------");
        await offerToken.connect(addr2).approve(preMarket.target, tokens(10));
        await collateralToken.connect(addr2).approve(preMarket.target, tokens(20));

        let prevBalCollateral = await collateralToken.balanceOf(addr2.address);
        console.log("prevBalCollateral collateral", ethers.formatEther(prevBalCollateral.toString()));

        let prevBalContract1 = await collateralToken.balanceOf(preMarket.target);
        console.log("prevBalContract collateral", ethers.formatEther(prevBalContract1.toString()));

        let tx1 = await preMarket.connect(addr2).contributeToOffer(offerId1, tokens(20), tokens(10));
        let receipt1 = await tx1.wait();

        await expect(receipt1).to.emit(preMarket, "OfferContribution").withArgs(offerId1, addr2.address, tokens(20));

        let afterBalCollateral = await collateralToken.balanceOf(addr2.address);
        console.log("afterBalCollateral collateral", ethers.formatEther(afterBalCollateral.toString()));

        let afterBalContract1 = await collateralToken.balanceOf(preMarket.target);
        console.log("afterBalContract collateral", ethers.formatEther(afterBalContract1.toString()));

        let offerDetail1 = await preMarket.getOfferDetails(offerId1);
        expect(offerDetail1.amtSold).to.equal(tokens(10));
        expect(afterBalCollateral).to.equal(prevBalCollateral - tokens(20));
        expect(afterBalContract1).to.equal(prevBalContract1 + tokens(20));

        // distribute tokens
        console.log("------Distributing tokens-------");

        // let prevUserBalCollateral = await collateralToken.balanceOf(addr2.address);
        // console.log("prevUserBal collateral", ethers.formatEther(prevUserBalCollateral.toString()));

        // let prevUserBalStable = await stableToken.balanceOf(addr2.address);
        // console.log("prevUserBal stable", ethers.formatEther(prevUserBalStable.toString()));

        // let prevCreatorBal = await offerToken.balanceOf(offer1.creator);
        // console.log("prevCreatorBal offer", ethers.formatEther(prevCreatorBal.toString()));

        // let prevBalContract2 = await collateralToken.balanceOf(preMarket.target);
        // console.log("prevBalContract collateral", ethers.formatEther(prevBalContract2.toString()));

        // let prevBalContract3 = await stableToken.balanceOf(preMarket.target);
        // console.log("prevBalContract stable", ethers.formatEther(prevBalContract3.toString()));

        // // set TGE to current time
        // await preMarket.connect(deployer).editTimestamps(offer1.OfferToken, Math.ceil(Date.now()/1000) - 5, Math.ceil(Date.now()/1000));

        // let tx2 = await preMarket.connect(addr1).distributeTokensBuy(offerId1, addr2.address);
        // let receipt2 = await tx2.wait();

        // await expect(receipt2).to.emit(preMarket, "TokensDistributed").withArgs(offerId1, addr2.address);

        // let afterUserBalCollateral = await collateralToken.balanceOf(addr2.address);
        // console.log("afterUserBal collateral", ethers.formatEther(afterUserBalCollateral.toString()));

        // let afterUserBalStable = await stableToken.balanceOf(addr2.address);
        // console.log("afterUserBalStable stable", ethers.formatEther(afterUserBalStable.toString()));

        // let afterCreatorBal = await offerToken.balanceOf(offer1.creator);
        // console.log("afterCreatorBal offer", ethers.formatEther(afterCreatorBal.toString()));

        // let afterBalContract2 = await collateralToken.balanceOf(preMarket.target);
        // console.log("afterBalContract collateral", ethers.formatEther(afterBalContract2.toString()));

        // let afterBalContract3 = await stableToken.balanceOf(preMarket.target);
        // console.log("afterBalContract stable", ethers.formatEther(afterBalContract3.toString()));

        // let receiveAmount = tokens(20).toString() - ((tokens(20).toString() * commissions[0].toString() / commissions[1].toString())/100);
        // receiveAmount = receiveAmount.toString();

        // await expect(afterUserBalCollateral).to.equal((prevUserBalCollateral) + tokens(20));
        // await expect(afterCreatorBal).to.equal(BigInt(Number(prevCreatorBal) + Number(offerDetail1.amtSold)));
        // await expect(afterUserBalStable).to.equal(BigInt(Number(prevUserBalStable) + Number(receiveAmount)));

        // distribute tokens after 24 hours of TGE
        console.log("------Distributing tokens after 24 hrs of TGE-------");

        let prevCreatorBalCollateral = await collateralToken.balanceOf(offer1.creator);
        console.log("prevCreatorBal collateral", ethers.formatEther(prevCreatorBalCollateral.toString()));

        let prevCreatorBalStable = await stableToken.balanceOf(offer1.creator);
        console.log("prevCreatorBal stable", ethers.formatEther(prevCreatorBalStable.toString()));

        let prevBalContract4 = await collateralToken.balanceOf(preMarket.target);
        console.log("prevBalContract collateral", ethers.formatEther(prevBalContract4.toString()));

        let prevBalContract5 = await stableToken.balanceOf(preMarket.target);
        console.log("prevBalContract stable", ethers.formatEther(prevBalContract5.toString()));

        let prevBalDeployer1 = await collateralToken.balanceOf(deployer.address);
        console.log("prevBalDeployer collateral", ethers.formatEther(prevBalDeployer1.toString()));

        // set the time to 24 hours after TGE
        await preMarket.connect(deployer).editTimestamps(offer1.OfferToken, Math.ceil(Date.now()/1000) - 96600, Math.ceil(Date.now()/1000) - 96400);

        let tx4 = await preMarket.connect(addr1).distributeAfter24HoursBuy(offerId1);
        let receipt4 = await tx4.wait();

        await expect(receipt4).to.emit(preMarket, "CollateralTokensDistributed").withArgs(offerId1, addr1.address);

        let afterCreatorBalCollateral = await collateralToken.balanceOf(offer1.creator);
        console.log("afterCreatorBal collateral", ethers.formatEther(afterCreatorBalCollateral.toString()));

        let afterCreatorBalStable = await stableToken.balanceOf(offer1.creator);
        console.log("afterCreatorBal stable", ethers.formatEther(afterCreatorBalStable.toString()));

        let afterBalDeployer1 = await collateralToken.balanceOf(deployer.address);
        console.log("afterBalDeployer1 collateral", ethers.formatEther(afterBalDeployer1.toString()));

        let commissionAmountStable = (offerDetail1.StableTokenAmount.toString() * commissions[0].toString() / commissions[1].toString())/100;
        let receiveAmountStable = offerDetail1.StableTokenAmount.toString() - commissionAmountStable;
        receiveAmountStable = receiveAmountStable.toString();

        let commissionAmountCollateral = (tokens(20).toString() * commissions[0].toString() / commissions[1].toString())/100;
        let receiveAmountCollateral = tokens(20).toString() - commissionAmountCollateral;
        receiveAmountCollateral = receiveAmountCollateral.toString();

        let commissionAmountDeployer = (tokens(20).toString() * commissions[0].toString() / commissions[1].toString())/100;
        commissionAmountDeployer = commissionAmountDeployer.toString();

        await expect(afterCreatorBalCollateral).to.equal(BigInt(Number(prevCreatorBalCollateral) + Number(receiveAmountCollateral)));
        await expect(afterCreatorBalStable).to.equal(BigInt(Number(prevCreatorBalStable) + Number(receiveAmountStable)));
        await expect(afterBalDeployer1).to.equal(BigInt(Number(prevBalDeployer1) + Number(commissionAmountDeployer)));
    });

    // create a new offer2 of offer type BUY and check the cancel flow after creating the offer
    it.skip("create a new offer2 of offer type BUY and check the cancel flow after creating the offer", async() => {
        // create offer
        console.log("-------Creating offer2-------");
        await preMarket.setCommission(25, 10);

        await stableToken.connect(addr1).approve(preMarket.target, tokens(200));

        let prevBalStable = await stableToken.balanceOf(addr1.address);
        console.log("prevBalStable stable", ethers.formatEther(prevBalStable.toString()));

        let tx = await preMarket.connect(addr1).createOffer(offer1);
        let receipt = await tx.wait();

        await expect(receipt).to.emit(preMarket, "OfferCreated").withArgs(0, addr1.address);
        offerId1 = 0;

        let afterBalStable = await stableToken.balanceOf(addr1.address);
        console.log("afterBalStable stable", ethers.formatEther(afterBalStable.toString()));

        expect(afterBalStable).to.equal(prevBalStable - offer1.StableTokenAmount);

        let offerDetail = await preMarket.getOfferDetails(offerId1);
        expect(offerDetail.OfferTokenAmount).to.equal(offer1.OfferTokenAmount);
        expect(offerDetail.OfferToken).to.equal(offer1.OfferToken);
        expect(offerDetail.creator).to.equal(offer1.creator);

        // cancel the offer
        console.log("------Cancelling offer2-------");

        let prevBalStable1 = await stableToken.balanceOf(addr1.address);
        console.log("prevBalStable stable", ethers.formatEther(prevBalStable1.toString()));

        let tx1 = await preMarket.connect(addr1).cancelOffer(offerId1);
        let receipt1 = await tx1.wait();

        await expect(receipt1).to.emit(preMarket, "OfferCancelled").withArgs(offerId1, addr1.address);

        let afterBalStable1 = await stableToken.balanceOf(addr1.address);
        console.log("afterBalStable stable", ethers.formatEther(afterBalStable1.toString()));

        let commissions = await preMarket.getCommissionPercentage();
        let commissionAmount = (offerDetail.StableTokenAmount.toString() * commissions[0].toString() / commissions[1].toString())/100;
        commissionAmount = commissionAmount.toString();

        let receiveAmount = offerDetail.StableTokenAmount.toString() - commissionAmount;
        receiveAmount = receiveAmount.toString();

        await expect(afterBalStable1).to.equal(BigInt(Number(prevBalStable1) + Number(receiveAmount)));
    });

    it.skip("create a new offer2 of offer type SELL and check the cancel flow after creating the offer", async() => {
        // create offer
        console.log("-------Creating offer2-------");
        await preMarket.setCommission(25, 10);

        await collateralToken.connect(addr1).approve(preMarket.target, tokens(200));

        let prevBalCollateral = await collateralToken.balanceOf(addr1.address);
        console.log("prevBalCollateral collateral", ethers.formatEther(prevBalCollateral.toString()));

        let tx = await preMarket.connect(addr1).createOffer(offer);
        let receipt = await tx.wait();

        await expect(receipt).to.emit(preMarket, "OfferCreated").withArgs(0, addr1.address);
        offerId = 0;

        let afterBalCollateral = await collateralToken.balanceOf(addr1.address);
        console.log("afterBalCollateral collateral", ethers.formatEther(afterBalCollateral.toString()));

        expect(afterBalCollateral).to.equal(prevBalCollateral - offer.CollateralTokenAmount);

        let offerDetail = await preMarket.getOfferDetails(offerId);
        expect(offerDetail.OfferTokenAmount).to.equal(offer.OfferTokenAmount);
        expect(offerDetail.OfferToken).to.equal(offer.OfferToken);
        expect(offerDetail.creator).to.equal(offer.creator);

        // cancel the offer
        console.log("------Cancelling offer2-------");

        let prevBalCollateral1 = await collateralToken.balanceOf(addr1.address);
        console.log("prevBalCollateral collateral", ethers.formatEther(prevBalCollateral1.toString()));

        let prevBalDeployer = await collateralToken.balanceOf(deployer.address);
        console.log("prevBalDeployer collateral", ethers.formatEther(prevBalDeployer.toString()));

        let tx1 = await preMarket.connect(addr1).cancelOffer(offerId);
        let receipt1 = await tx1.wait();

        await expect(receipt1).to.emit(preMarket, "OfferCancelled").withArgs(offerId, addr1.address);

        let afterBalCollateral1 = await collateralToken.balanceOf(addr1.address);
        console.log("afterBalCollateral collateral", ethers.formatEther(afterBalCollateral1.toString()));

        let afterBalDeployer = await collateralToken.balanceOf(deployer.address);
        console.log("afterBalDeployer collateral", ethers.formatEther(afterBalDeployer.toString()));

        let commissions = await preMarket.getCommissionPercentage();
        let commissionAmount = (offerDetail.CollateralTokenAmount.toString() * commissions[0].toString() / commissions[1].toString())/100;
        commissionAmount = commissionAmount.toString();

        let receiveAmount = offerDetail.CollateralTokenAmount.toString() - commissionAmount;
        receiveAmount = receiveAmount.toString();

        await expect(afterBalCollateral1).to.equal(BigInt(Number(prevBalCollateral1) + Number(receiveAmount)));
        await expect(afterBalDeployer).to.equal(BigInt(Number(prevBalDeployer) + Number(commissionAmount)));
    });
});