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
    body: `${BUCKET_A_PCT}% goes into your retirement bucket, which nothing can unlock early. ${BUCKET_B_PCT}% goes into an emergency bucket you can sell if life demands it.`,
  },
  {
    title: 'Stake and compound',
    body: `The whole rung is staked. ${100 - PROTOCOL_FEE_PCT}% of the yield stays inside and compounds; ${PROTOCOL_FEE_PCT}% funds the protocol. Nothing drips out along the way.`,
  },
  {
    title: 'Mature and claim',
    body: `${LOCK_YEARS} years later the rung is yours. Claim it whenever you like. A rung you haven't claimed keeps earning.`,
  },
];

export const NEVER = [
  ['Touch your principal', 'Governance can add or retire staking integrations. It can never move a deposit, change a maturity date, or reach your shares.'],
  ['Let anyone withdraw early', 'Not you, not us, not for a fee. The retirement bucket matures on schedule, full stop.'],
  ['Hold your keys', 'Your wallet owns your ladder. It can be a multisig or a smart account if you want recovery or inheritance built on top.'],
  ['Bridge your funds', 'BNB stays on BNB Smart Chain and ETH stays on Ethereum, as two separate deployments. Bridges are where this industry loses the most money.'],
  ['Pay you a drip', 'Monthly income is exactly what you joined to stop spending, so yield compounds inside until the rung matures.'],
  ['Promise a return', 'Returns depend on the asset. The calculator shows what happens at 0% growth too.'],
];

export const FOR = [
  ['Paid in crypto', 'Developers, designers and operators who draw a salary in BNB, ETH or stablecoins, and have no pension scheme behind them.'],
  ['Paid per project', 'Freelancers and creators whose income arrives in bursts, and who want the good months to count for something later.'],
  ['Paid in tokens', 'Founders and contributors who know exactly how tempting a strong week is, and would rather decide once than every week.'],
];

export const ROADMAP = [
  ['Protocol specification', 'Cohorts, the 70/30 split, share accounting and the secondary market, written down.', 'done', 'Done'],
  ['Website and waitlist', 'You are here.', 'now', 'Live now'],
  ['Smart contracts', 'Vault, staking adapters, harvester and escrow market, built against the specification.', 'next', 'Next'],
  ['Independent security audit', 'No deposit is accepted before contracts have been audited.', 'planned', 'Before launch'],
  ['BNB Smart Chain launch', 'The first deployment, and the first cohort.', 'planned', 'After audit'],
  ['Ethereum deployment', 'A separate, independent deployment of the same contracts.', 'planned', 'After BSC'],
];

export const FAQ = [
  ['Will BNB and ETH do this again?', 'Nobody knows. The prices on this page are real history, not a forecast. Plenty of coins people bought in 2017 are worth nothing today. A lock protects you from selling something good in a panic. It cannot make a bad asset good.'],
  ['Can I get my money out early?', `No. The ${BUCKET_A_PCT}% retirement bucket cannot be withdrawn, sold or transferred until it matures. The ${BUCKET_B_PCT}% emergency bucket can be sold to another person for USDT or USDC through an escrow: you accept their offer, get a 7-day cooling-off period to change your mind, and the sale settles. It closes 7 days before maturity.`],
  ['What if I lose access to my wallet?', 'Then the ladder is lost. The protocol holds no keys and keeps no beneficiary register, because a contract open to the whole world cannot fairly settle every inheritance law. If you want recovery or inheritance, own your ladder from a multisig or smart account and set that up yourself.'],
  ['Where does the yield come from?', `Deposits are staked through established liquid staking providers on each chain, chosen before launch. The yield stays inside and raises the value of every share; ${PROTOCOL_FEE_PCT}% of it goes to the protocol.`],
  ['Is my return guaranteed?', 'No. You get your share of the pool. If the asset falls, your ladder falls with it. If a staking provider is slashed or depegs, every depositor shares the loss.'],
  ['What happens when a rung matures?', 'Nothing, until you claim it. Unclaimed rungs keep earning. When you claim, you choose between swapping immediately at market, or joining the unstaking queue and receiving the full amount a few days later.'],
  ['Why only BNB and ETH?', 'They are the two assets here with native staking on chains the protocol can deploy to without a bridge. Bitcoin earns no native yield, and wrapped versions add custody risk a ten-year lock should not carry.'],
  ['Can I use it where I live?', 'Nothing is live yet. When it is, the contracts will be open to anyone with a wallet, but whether you may use them depends on the rules where you live.'],
];
