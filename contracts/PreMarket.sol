// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PreMarket is Ownable, ReentrancyGuard{
    enum OfferType {
        BUY,
        SELL
    }

    struct TokenDetails {
        uint256 tgeStart; // timestamp when the TGE starts
        uint256 tgeEnd; // timestamp when the TGE ends
    }

    struct Offer {
      OfferType offerType; // type of the offer (BUY or SELL)
      address OfferToken;
      uint256 OfferTokenAmount; 
      address StableToken; 
      uint256 StableTokenAmount;
      address CollateralToken; 
      uint256 CollateralTokenAmount;
      address creator; // address of the user who created the offer
      uint256 amtSold; // amount of tokens sold
    }

    Offer[] private offers;
    uint256 private offerCount = 0;
    mapping (address => uint256[]) private userOffers;

    // token address -> token details
    mapping(address => TokenDetails) private tokenDetails;

    // offerId -> user -> claimable amount
    mapping(uint256 => mapping(address => uint256)) private claimableTokens; 

    // offerId -> user -> locked receive tokens
    mapping(uint256 => mapping(address => uint256)) private lockedReceiveTokens;

    // Mapping to store contributors for each offer
    mapping(uint256 => address[]) private offerContributors;

    // store contribution amount for each user for each offer
    mapping(uint256 => mapping(address => uint256)) private contributionAmount;

    uint256 private commissionPercentage;
    uint256 private scale;
    mapping(address => uint256) private commissionBalance; // Track commission balances by token address

    event OfferCreated(uint256 indexed offerId, address indexed creator);
    event OfferContribution(uint256 indexed offerId, address indexed contributor, uint256 contributionAmount);
    event TokensDistributed(uint256 indexed offerId, address indexed creator);
    event CollateralTokensDistributed(uint256 indexed offerId, address indexed creator);
    event CommissionWithdrawn(address indexed tokenAddress, uint256 amount);
    event OfferCancelled(uint256 indexed offerId, address indexed creator);

    constructor() Ownable(msg.sender) {}

    function createOffer(
        Offer memory _offer
    ) external nonReentrant {
        require(_offer.offerType == OfferType.BUY || _offer.offerType == OfferType.SELL, "Invalid offer type");

        Offer memory newOffer = Offer({
            offerType: _offer.offerType,
            OfferToken: _offer.OfferToken,
            OfferTokenAmount: _offer.OfferTokenAmount,
            StableToken: _offer.StableToken,
            StableTokenAmount: _offer.StableTokenAmount,
            CollateralToken: _offer.CollateralToken,
            CollateralTokenAmount: _offer.CollateralTokenAmount,
            creator: msg.sender,
            amtSold: 0
        });

        if (_offer.offerType == OfferType.BUY) {
            // Calculate commission for buy offers
            uint256 commissionAmount = (_offer.StableTokenAmount * commissionPercentage) / (scale * 100);

            // Add the commission to the contract's commission balance
            commissionBalance[_offer.StableToken] += commissionAmount;

            // Lock the user's stable tokens in the contract
            lockedReceiveTokens[offerCount][msg.sender] += _offer.StableTokenAmount - commissionAmount;

            // Transfer the remaining stable tokens (after commission) to the contract
            bool success = IERC20(_offer.StableToken).transferFrom(msg.sender, address(this), _offer.StableTokenAmount);
            require(success, "Stable token transfer failed");

            // Transfer commission amount to the platform/contract owner
            bool commissionSuccess = IERC20(_offer.StableToken).transfer(owner(), commissionAmount);
            require(commissionSuccess, "Commission transfer failed");

        } else if (_offer.offerType == OfferType.SELL) {
            // Lock the user's collateral tokens in the contract
            lockedReceiveTokens[offerCount][msg.sender] += _offer.CollateralTokenAmount;

            // Transfer collateral tokens to the contract for sell offers
            bool success = IERC20(_offer.CollateralToken).transferFrom(msg.sender, address(this), _offer.CollateralTokenAmount);
            require(success, "Collateral token transfer failed");
        }

        offers.push(newOffer);
        userOffers[msg.sender].push(offerCount);
        offerCount++;

        emit OfferCreated(offerCount - 1, msg.sender);
    }

    function contributeToOffer(
        uint256 _offerId, 
        uint256 _contributionAmount, 
        uint256 _offerTokenAmount
    ) external nonReentrant {
        Offer storage offer = offers[_offerId];

        require(block.timestamp < tokenDetails[offer.OfferToken].tgeStart, "TGE already passed, you can't contribute now");
        require(offer.creator != msg.sender, "Creator cannot contribute to their own offer");
        require(_contributionAmount > 0, "Contribution amount must be greater than zero");

        uint256 proportionalOfferTokens = _offerTokenAmount;
        require(proportionalOfferTokens <= offer.OfferTokenAmount - offer.amtSold, "Not enough tokens left in offer");

        if (offer.offerType == OfferType.SELL) {
            // For sell offers, transfer stable tokens and deduct commission
            uint256 commissionAmount = (_contributionAmount * commissionPercentage) / (scale * 100);

            // Add the commission to the contract's balance
            commissionBalance[offer.StableToken] += commissionAmount;

            // Transfer the stable tokens (after deducting commission) to the contract
            bool success = IERC20(offer.StableToken).transferFrom(msg.sender, address(this), _contributionAmount);
            require(success, "Stable token transfer failed");

            // Transfer commission amount to the platform/contract owner
            bool commissionSuccess = IERC20(offer.StableToken).transfer(owner(), commissionAmount);
            require(commissionSuccess, "Commission transfer failed");
        } 
        else if (offer.offerType == OfferType.BUY) {
            // Transfer collateral tokens to the contract (no commission)
            bool success = IERC20(offer.CollateralToken).transferFrom(msg.sender, address(this), _contributionAmount);
            require(success, "Collateral token transfer failed");
        }

        offer.amtSold += proportionalOfferTokens;
        claimableTokens[_offerId][msg.sender] += proportionalOfferTokens;

        // Add the contributor if it's their first contribution
        if (claimableTokens[_offerId][msg.sender] == proportionalOfferTokens) {
            offerContributors[_offerId].push(msg.sender);
        }

        contributionAmount[_offerId][msg.sender] += _contributionAmount;

        emit OfferContribution(_offerId, msg.sender, _contributionAmount);
    }

    function distributeTokensSell(uint256 _offerId) external nonReentrant {
        Offer storage offer = offers[_offerId];
        require(offer.creator == msg.sender, "Only the offer creator can distribute tokens");
        require(block.timestamp >= tokenDetails[offer.OfferToken].tgeStart, "TGE not reached yet");

        address[] memory contributors = offerContributors[_offerId];
        uint256 totalContributors = contributors.length;

        for (uint256 i = 0; i < totalContributors; i++) {
            address contributor = contributors[i];
            uint256 claimableAmount = claimableTokens[_offerId][contributor];
            uint256 contributedAmt = contributionAmount[_offerId][contributor];

            require(claimableAmount > 0, "No claimable tokens to distribute");
            require(contributedAmt > 0, "No locked stable token to distribute");

            // Reset claimable  amounts
            claimableTokens[_offerId][contributor] = 0;

            // Sell offer: transfer offer tokens to contributor, collateral tokens to creator, and locked stable tokens to creator
                    
            // Transfer offer tokens to the contributor
            bool offerTokenSuccess = IERC20(offer.OfferToken).transferFrom(offer.creator, contributor, claimableAmount);
            require(offerTokenSuccess, "Offer token transfer to contributor failed");

            // Transfer locked stable tokens to offer creator
            bool receiveTokenSuccess = IERC20(offer.StableToken).transfer(offer.creator, contributedAmt - (contributedAmt * commissionPercentage) / (scale * 100));
            require(receiveTokenSuccess, "Stable token transfer to creator failed");
        }

        // Transfer collateral tokens back to offer creator
        bool collateralTokenSuccess = IERC20(offer.CollateralToken).transfer(offer.creator, offer.CollateralTokenAmount);
        require(collateralTokenSuccess, "Collateral token transfer to creator failed");

        emit TokensDistributed(_offerId, msg.sender);
    }

    function distributeTokensBuy(uint256 _offerId, address contributor) external nonReentrant {
        Offer storage offer = offers[_offerId];
        require(block.timestamp >= tokenDetails[offer.OfferToken].tgeStart, "TGE not reached yet");

        uint256 claimableAmount = claimableTokens[_offerId][contributor];
        uint256 contributedAmt = contributionAmount[_offerId][contributor];

        require(claimableAmount > 0, "No claimable tokens to distribute");
        require(contributedAmt > 0, "No locked stable token to distribute");

        // Reset claimable amounts
        claimableTokens[_offerId][contributor] = 0;

        // Buy offer: transfer offer tokens to creator, collateral tokens to contributor, and locked stable tokens to contributor

        // Transfer offer tokens to the offer creator
        bool offerTokenSuccess = IERC20(offer.OfferToken).transferFrom(contributor, offer.creator, claimableAmount);
        require(offerTokenSuccess, "Offer token transfer to creator failed");

        // Transfer locked collateral tokens to the contributor
        bool collateralTokenSuccess = IERC20(offer.CollateralToken).transfer(contributor, contributedAmt);
        require(collateralTokenSuccess, "Collateral token transfer to contributor failed");

        // Transfer locked stable tokens to the contributor
        uint256 netStableToken = contributedAmt - (contributedAmt * commissionPercentage) / (scale * 100);
        bool receiveTokenSuccess = IERC20(offer.StableToken).transfer(contributor, netStableToken);
        require(receiveTokenSuccess, "Stable token transfer to contributor failed");
        
        emit TokensDistributed(_offerId, contributor);
    }

    function distributeBuyPartialCreator(uint256 _offerId) external nonReentrant {
        Offer storage offer = offers[_offerId];
        require(offer.creator == msg.sender, "Only the offer creator can call this function");
        require(block.timestamp >= tokenDetails[offer.OfferToken].tgeStart, "TGE not reached yet");

        uint256 totalContributedAmt = 0;
        address[] memory contributors = offerContributors[_offerId];
        uint256 totalContributors = contributors.length;

        for (uint256 i = 0; i < totalContributors; i++) {
            totalContributedAmt += contributionAmount[_offerId][contributors[i]];
        }

        // Now, deduct the total contributed amount from the locked stable tokens and transfer to the creator
        uint256 netStableToken = lockedReceiveTokens[_offerId][offer.creator] - totalContributedAmt;
        bool receiveTokenSuccess = IERC20(offer.StableToken).transfer(offer.creator, netStableToken);
        require(receiveTokenSuccess, "Stable token transfer to creator failed");

        emit TokensDistributed(_offerId, msg.sender);
    }

    function distributeAfter24HoursSell(uint256 _offerId, address contributor) external nonReentrant {
        Offer storage offer = offers[_offerId];
        require(contributor == msg.sender, "Only the contributor can call this function");
        require(block.timestamp >= tokenDetails[offer.OfferToken].tgeEnd, "TGE settle end time hasn't passed yet");

        uint256 contributedAmt = contributionAmount[_offerId][contributor];

        // Reset contribution amounts
        require(contributedAmt > 0, "No locked tokens to distribute");
        contributionAmount[_offerId][contributor] = 0;

        // For sell offers:
        // - Deduct commission from collateral and transfer collateral to contributor
        // - Transfer locked stable tokens back to the contributor

        uint256 commissionAmount1 = (contributedAmt * commissionPercentage) / (scale * 100);
        uint256 receiveAmt = contributedAmt - commissionAmount1;

        // Transfer collateral tokens to contributor
        bool collateralTokenSuccess = IERC20(offer.CollateralToken).transfer(contributor, receiveAmt);
        require(collateralTokenSuccess, "Collateral token transfer to contributor failed");

        // Transfer locked stable tokens back to contributor
        bool receiveTokenSuccess = IERC20(offer.StableToken).transfer(contributor, receiveAmt);
        require(receiveTokenSuccess, "Stable token transfer to contributor failed");

        // Transfer commission amount to the platform/contract owner
        commissionBalance[offer.CollateralToken] += commissionAmount1;

        bool commissionSuccess = IERC20(offer.CollateralToken).transfer(owner(), commissionAmount1);
        require(commissionSuccess, "Commission transfer of collateral token failed");

        emit CollateralTokensDistributed(_offerId, msg.sender);
    }

    function distributeAfter24HoursBuy(uint256 _offerId) external nonReentrant {
        Offer storage offer = offers[_offerId];
        require(offer.creator == msg.sender, "Only the offer creator can call this function");
        require(block.timestamp >= tokenDetails[offer.OfferToken].tgeEnd, "TGE settle end time hasn't passed yet");

        uint256 lockedReceiveAmount = lockedReceiveTokens[_offerId][offer.creator];
        require(lockedReceiveAmount > 0, "No locked tokens to distribute");

        address[] memory contributors = offerContributors[_offerId];
        uint256 totalContributors = contributors.length;

        for (uint256 i = 0; i < totalContributors; i++) {
            address contributor = contributors[i];

            // Reset locked amounts
            lockedReceiveTokens[_offerId][contributor] = 0;

            // For buy offers:
            // - Deduct commission from collateral and transfer to offer creator
            // - Transfer locked stable tokens back to the creator

            uint256 commissionAmount = (contributionAmount[_offerId][contributor] * commissionPercentage) / (scale * 100);
            uint256 collateralAfterCommission = contributionAmount[_offerId][contributor] - commissionAmount;

            // Transfer collateral tokens (after commission) to creator
            bool collateralTokenSuccess = IERC20(offer.CollateralToken).transfer(offer.creator, collateralAfterCommission);
            require(collateralTokenSuccess, "Collateral token transfer to creator failed");

            // Transfer commission amount to the platform/contract owner
            commissionBalance[offer.CollateralToken] += commissionAmount;

            bool commissionSuccess = IERC20(offer.CollateralToken).transfer(owner(), commissionAmount);
            require(commissionSuccess, "Commission transfer of collateral token failed");
        }
        // Transfer locked stable tokens to the creator
        bool receiveTokenSuccess = IERC20(offer.StableToken).transfer(offer.creator, lockedReceiveAmount);
        require(receiveTokenSuccess, "Stable token transfer to creator failed");

        emit CollateralTokensDistributed(_offerId, msg.sender);
    }

    // If contributor has not contributed then only creator can cancel the offer (buy/sell)
    function cancelOffer(uint256 _offerId) external nonReentrant {
        Offer storage offer = offers[_offerId];
        require(offer.creator == msg.sender, "Only the offer creator can cancel the offer");

        address[] memory contributors = offerContributors[_offerId];
        uint256 totalContributors = contributors.length;

        if(totalContributors == 0){
            if (offer.offerType == OfferType.BUY) {
                // Transfer locked stable tokens back to the creator (commission already deducted during creation)
                bool receiveTokenSuccess = IERC20(offer.StableToken).transfer(offer.creator, lockedReceiveTokens[_offerId][offer.creator]);
                require(receiveTokenSuccess, "Stable token transfer to creator failed");
            } else if (offer.offerType == OfferType.SELL) {
                // Transfer locked collateral tokens back to the creator after deduction of commission
                uint256 commissionAmount = (offer.CollateralTokenAmount * commissionPercentage) / (scale * 100);
                uint256 receiveAmt = offer.CollateralTokenAmount - commissionAmount;

                bool collateralTokenSuccess = IERC20(offer.CollateralToken).transfer(offer.creator, receiveAmt);
                require(collateralTokenSuccess, "Collateral token transfer to creator failed");

                // Transfer commission amount to the platform/contract owner
                commissionBalance[offer.CollateralToken] += commissionAmount;

                bool commissionSuccess = IERC20(offer.CollateralToken).transfer(owner(), commissionAmount);
                require(commissionSuccess, "Commission transfer of collateral token failed");
            }
        }

        delete offers[_offerId];
        emit OfferCancelled(_offerId, msg.sender);
    }

    function addToken(
        address _tokenAddress, 
        uint256 _tgeStart,
        uint256 _tgeEnd
    ) external onlyOwner {
        require(_tokenAddress != address(0), "Invalid token address");

        // Check if the token is already added
        require(tokenDetails[_tokenAddress].tgeStart == 0, "Token already added");

        tokenDetails[_tokenAddress] = TokenDetails({
            tgeStart: _tgeStart,
            tgeEnd: _tgeEnd
        });
    }

    function getTokenDetails(address _tokenAddress) external view returns (TokenDetails memory) {
        return tokenDetails[_tokenAddress];
    }

    function editTimestamps(address _tokenAddress, uint256 _tgeStart, uint256 _tgeEnd) external onlyOwner {
        require(_tokenAddress != address(0), "Invalid token address");

        tokenDetails[_tokenAddress].tgeStart = _tgeStart;
        tokenDetails[_tokenAddress].tgeEnd = _tgeEnd;
    }

    function setCommission(uint256 _commissionPercentage, uint256 _scale) external onlyOwner{
        require(_scale > 0, "Scale must be greater than zero");
        commissionPercentage = _commissionPercentage;
        scale = _scale;
    }

    function getCommissionPercentage() external view returns (uint256, uint256) {
        return (commissionPercentage, scale);
    }

    function getCommissionBalance(address _tokenAddress) external view returns (uint256) {
        return commissionBalance[_tokenAddress];
    }

    function getUserOffers(address _trader) external view returns (Offer[] memory) {
        uint256 totalOffers = userOffers[_trader].length;
        Offer[] memory myOffers = new Offer[](totalOffers);
        for (uint256 i = 0; i < totalOffers; i++) {
            myOffers[i] = offers[userOffers[_trader][i]];
        }
        return myOffers;
    }

    function getOfferDetails(uint256 index) public view returns (Offer memory) {
        return offers[index];
    }

    function getLastAddedOfferIndex(address _trader) public view returns (uint256) {
        return userOffers[_trader][userOffers[_trader].length - 1];
    }

    function getContributors(uint256 _offerId) external view returns (address[] memory) {
        return offerContributors[_offerId];
    }

    function getContributionAmount(uint256 _offerId, address _contributor) external view returns (uint256) {
        return contributionAmount[_offerId][_contributor];
    }
}