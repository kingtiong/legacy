import { NAME, LOCK_YEARS, BUCKET_A_PCT, BUCKET_B_PCT, PROTOCOL_FEE_PCT } from './config';

export const PROTECTS = [
  ['From the crash', 'An 88% fall is exactly when people sell. Your retirement bucket has no sell button to press.'],
  ['From the rally', 'A hundredfold year is exactly when people buy the car. Nothing in the retirement bucket can be spent before it matures.'],
  ['From pressure', 'When someone needs money from you urgently, or a friend has an opportunity that can’t wait, “I can’t touch it” is simply true.'],
  ['From a stolen key', `During the lock, anyone holding your key can reach at most the ${BUCKET_B_PCT}% emergency bucket, and only through a sale that takes seven days to settle.`],
];

export const STEPS = [
  {
    title: 'Deposit',
    body: `Send BNB, from 0.01 BNB, any month. That deposit becomes one rung, and its ${LOCK_YEARS}-year clock starts the moment it lands.`,
  },
  {
    title: 'Split',
    body: `At least ${BUCKET_A_PCT}% goes into your retirement bucket, which nothing can unlock early. Up to ${BUCKET_B_PCT}% goes into an emergency bucket you can sell if life demands it. You choose the split when you deposit.`,
  },
  {
    title: 'Stake and compound',
    body: `The whole rung is staked with BNB Chain validators. ${100 - PROTOCOL_FEE_PCT}% of the rewards stay inside and compound; ${PROTOCOL_FEE_PCT}% go to a treasury that depositors control by vote. Nothing drips out along the way.`,
  },
  {
    title: 'Mature and claim',
    body: `${LOCK_YEARS} years later the rung is yours. Claim all or part of it whenever you like; if the BNB has to be unstaked first, that takes about 7 days. A rung you haven't claimed keeps earning.`,
  },
];

export const NEVER = [
  ['Touch your principal', 'Depositors vote through the DAO to change validators and spend fee income. No vote can move a deposit, change a maturity date, or reach your shares, and the team holds no role at all.'],
  ['Let anyone withdraw early', 'Not you, not us, not for a fee. The retirement bucket matures on schedule, full stop.'],
  ['Hold your keys', 'Your wallet owns your ladder. It can be a multisig or a smart account if you want recovery or inheritance built on top.'],
  ['Bridge your funds', 'Your BNB stays on BNB Smart Chain and is staked natively, with no bridge or wrapped token in between. Bridges are where this industry loses the most money.'],
  ['Pay you a drip', 'Monthly income is exactly what you joined to stop spending, so yield compounds inside until the rung matures.'],
  ['Promise a return', 'Returns depend on the asset. The calculator shows what happens at 0% growth too.'],
];

export const FOR = [
  ['Paid in crypto', 'Developers, designers and operators who draw a salary in BNB, ETH or stablecoins, and have no pension scheme behind them.'],
  ['Paid per project', 'Freelancers and creators whose income arrives in bursts, and who want the good months to count for something later.'],
  ['Paid in tokens', 'Founders and contributors who know exactly how tempting a strong week is, and would rather decide once than every week.'],
];

export const ROADMAP = [
  ['Protocol specification', 'Cohorts, the 70/30 split, share accounting, the emergency-share market and the DAO, written down and published.', 'done', 'Done'],
  ['Smart contracts', 'Vault, market and depositor DAO. Open source, tested against a copy of BNB Chain mainnet, verified on Sourcify.', 'done', 'Done'],
  ['BNB Smart Chain launch', 'Deployed 14 September 2026. Deposits were paused on 16 September, before any were made, after a pre-audit review found an issue that could freeze withdrawals. A fixed version will be deployed before deposits reopen.', 'now', 'Paused'],
  ['Security fixes (v2)', 'The withdrawal issue and the smaller findings are fixed and tested, including against a copy of BNB Chain mainnet. Next: formal verification and redeployment.', 'next', 'In progress'],
  ['Depositor DAO', 'Protocol fees and the choice of validators are decided by depositor votes. The team holds no role in any contract. Its safeguards are being reviewed for v2.', 'next', 'Being revised'],
  ['Independent security audit', 'Not done yet. Until it is, the deposit caps keep the amount at risk small. Deposit only what you could afford to lose.', 'next', 'Not yet'],
  ['Ethereum', 'Possibly later, as a separate deployment. Nothing is planned or promised.', 'planned', 'Undecided'],
];

export const FAQ = [
  ['Will BNB and ETH do this again?', 'Nobody knows. The prices on this page are real history, not a forecast. Plenty of coins people bought in 2017 are worth nothing today. A lock protects you from selling something good in a panic. It cannot make a bad asset good.'],
  ['Can I get my money out early?', `No. The ${BUCKET_A_PCT}% retirement bucket cannot be withdrawn, sold or transferred until it matures. The ${BUCKET_B_PCT}% emergency bucket can be sold to another person for USDT or USDC through an escrow: you accept their offer, get a 7-day cooling-off period to change your mind, and the sale settles. It closes 7 days before maturity.`],
  ['What if I lose access to my wallet?', 'Then the ladder is lost. The protocol holds no keys and keeps no beneficiary register, because a contract open to the whole world cannot fairly settle every inheritance law. If you want recovery or inheritance, own your ladder from a multisig or smart account and set that up yourself.'],
  ['Where does the yield come from?', `BNB Chain’s own staking. The vault delegates deposits to established validators (Ankr, Figment, NodeReal and The48Club at launch), and depositors can change that list by DAO vote. Rewards stay inside and raise the value of every share; ${PROTOCOL_FEE_PCT}% of them go to the DAO treasury.`],
  ['Has it been audited?', 'No, not yet. The contracts are open source, tested against a copy of BNB Chain mainnet and verified on Sourcify, but no independent auditor has reviewed them. Deposit caps written into the contracts limit how much is at risk while it is young. Deposit only what you could afford to lose.'],
  ['Who controls it?', 'Nobody on the team. The contracts have no owner and cannot be upgraded. The only roles, spending protocol fees and choosing validators, belong to a DAO where every depositor’s shares are their votes. No vote can touch a deposit, change a maturity date or stop a withdrawal.'],
  ['Is my return guaranteed?', 'No. You get your share of the pool. If BNB falls, your ladder falls with it. Staking rewards vary, and the contracts are new and unaudited: a bug could cause losses that every depositor shares.'],
  ['What happens when a rung matures?', 'Nothing, until you claim it. Unclaimed rungs keep earning. Claim all or part whenever you like: the BNB is paid straight away if the vault holds enough unstaked, otherwise it is unstaked from BNB Chain first, which takes about 7 days.'],
  ['Why only BNB?', 'BNB has native staking on the chain the protocol lives on, so no bridge or wrapped token sits between you and your savings. Ethereum could follow one day as a separate deployment. Bitcoin earns no native yield, and wrapped versions add custody risk a ten-year lock should not carry.'],
  ['Can I use it where I live?', 'The contracts are open to anyone with a wallet, but whether you may use them depends on the rules where you live.'],
];
