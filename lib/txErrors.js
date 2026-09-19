// Plain-language reasons for the contracts' custom errors.
const REASONS = {
  ZeroAddress: 'An address is missing.',
  InvalidAmount: 'That amount is not allowed.',
  InvalidSplit: 'At least 70% must go to retirement.',
  DepositCapExceeded: 'The pool is full for this month. The limit rises every month.',
  NotMatured: 'These shares have not matured yet.',
  InvalidShareId: 'Unknown share.',
  TransferRestricted: 'These shares cannot be moved.',
  NothingToFlush: 'Less than 1 BNB is waiting to be staked.',
  NoDelegationTarget: 'No validator is accepting stake right now.',
  ClaimNotReady: 'The claim is still unbonding.',
  AlreadyWithdrawn: 'This claim was already paid.',
  NotClaimOwner: 'Only the claim owner can do this.',
  InsufficientLiquidity: 'The BNB is not back from BNB Chain staking yet. Try again shortly.',
  ERC1155InsufficientBalance: 'You do not hold that many shares.',
  ERC1155MissingApprovalForAll: 'Allow the market to move your emergency shares first.',
  InvalidDuration: 'Offers last between 1 and 30 days.',
  InvalidToken: 'Unknown payment token.',
  UnsupportedToken: 'This token charges a transfer fee and cannot be used.',
  NotEmergencyShare: 'Only emergency-bucket shares can be sold.',
  CohortClosed: 'This month is too close to maturity to trade.',
  UnknownOffer: 'Offer not found.',
  UnknownSale: 'Sale not found.',
  OfferExpired: 'This offer has expired.',
  NotOfferedToYou: 'This offer is reserved for another holder.',
  NotBuyer: 'Only the buyer can do this.',
  NotSeller: 'Only the seller can do this.',
  SaleClosed: 'This sale is already settled or cancelled.',
  CoolingOffActive: 'The 7-day cooling-off has not ended.',
  CoolingOffOver: 'The 7-day cooling-off has ended.',
  NoSaleClaim: 'Nothing to withdraw for this sale.',
  SaleTooSmall: 'That sale is too small, or would leave an unsellable remainder. Buy the whole listing instead.',
  UnknownListing: 'Listing not found.',
  NotListingSeller: 'Only the seller can do this.',
  ListingClosed: 'This listing is already closed.',
  NoListingClaim: 'Nothing to withdraw for this listing.',
  ERC20InsufficientBalance: 'Not enough tokens in your wallet.',
  ERC20InsufficientAllowance: 'Approve the token first.',
  GovernorInsufficientProposerVotes: 'Your ladder is too small to make a proposal.',
  GovernorUnexpectedProposalState: 'The proposal is not at that stage.',
  GovernorAlreadyCastVote: 'You already voted on this proposal.',
  GovernorInvalidVoteType: 'Unknown vote.',
  TimelockUnexpectedOperationState: 'The 2-day timelock has not finished.',
  FailedCall: 'The proposal’s action failed. The treasury may not hold enough.',
};

export function explainError(error) {
  if (!error) return '';
  const named = typeof error.walk === 'function' ? error.walk((e) => e?.data?.errorName) : null;
  const name = named?.data?.errorName;
  if (name) return REASONS[name] || name;
  const text = error.shortMessage || error.message || 'Transaction failed';
  if (/user rejected|denied/i.test(text)) return 'You cancelled it in your wallet.';
  if (/insufficient funds/i.test(text)) return 'Not enough BNB in your wallet for this and the network fee.';
  return text.split('\n')[0].slice(0, 180);
}
