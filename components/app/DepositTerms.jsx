'use client';

import { useState } from 'react';
import { shortAddress } from '../ConnectButton';
import { bnb, day } from '../../lib/vaultHooks';
import { EXPLORER, GOVERNOR_ADDRESS, MARKET_ADDRESS, TEST_MODE, TREASURY_ADDRESS, VAULT_ADDRESS } from '../../lib/protocol';

const SOURCIFY = (a) => `https://repo.sourcify.dev/56/${a}`;

/** Everything a depositor agrees to, in plain words, before the wallet is asked to sign. */
export default function DepositTerms({ amount, toA, toB, unlocks, stats, account, lang, setLang, children, onBack, onAccept }) {
  const [ticks, setTicks] = useState([false, false, false, false]);
  const t = lang === 'zh' ? zh : en;
  const all = ticks.every(Boolean);
  const lock = TEST_MODE ? t.lockTest : t.lock;
  const unlockText = day(unlocks);

  return (
    <div className="terms">
      <div className="terms-top">
        <button type="button" className="btn ghost sm" onClick={onBack}>{t.back}</button>
        <div className="toggle lang-toggle">
          <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
          <button type="button" aria-pressed={lang === 'zh'} onClick={() => setLang('zh')}>中文</button>
        </div>
      </div>

      <section className="panel">
        <h2 className="h3">{t.title}</h2>
        <p className="muted">{t.intro}</p>
        <dl className="kv">
          <div><dt>{t.from}</dt><dd className="mono-sm">{account}</dd></div>
          <div><dt>{t.amount}</dt><dd className="tnum"><b>{bnb(amount)}</b></dd></div>
          <div><dt>{t.retirement}</dt><dd className="tnum">{bnb(toA)} (70%)</dd></div>
          <div><dt>{t.emergency}</dt><dd className="tnum">{bnb(toB)} (30%)</dd></div>
          <div><dt>{t.unlocks}</dt><dd><b>{unlockText}</b>{TEST_MODE && <span className="muted small"> · {t.testNote}</span>}</dd></div>
          <div><dt>{t.network}</dt><dd>BNB Smart Chain (56)</dd></div>
        </dl>
      </section>

      <section className="panel">
        <h2 className="h3">{t.rulesTitle}</h2>
        <ol className="rules">
          <li><b>{lock}</b> {t.lockBody(unlockText)}</li>
          <li><b>{t.r1h}</b> {t.r1}</li>
          <li className="rule-warn"><b>{t.r2h}</b> {t.r2}</li>
          <li><b>{t.r3h}</b> {t.r3}</li>
          <li><b>{t.r4h}</b> {t.r4}</li>
          <li><b>{t.r5h}</b> {t.r5}</li>
          <li><b>{t.r6h}</b> {t.r6}</li>
          <li><b>{t.r7h}</b> {t.r7(bnb(stats.MIN_DEPOSIT), bnb(stats.MAX_DEPOSIT))}</li>
        </ol>
      </section>

      <section className="panel panel-warn">
        <h2 className="h3">{t.riskTitle}</h2>
        <ul className="rules">
          <li><b>{t.k1h}</b> {t.k1}</li>
          <li><b>{t.k2h}</b> {t.k2}</li>
          <li><b>{t.k3h}</b> {t.k3}</li>
          <li><b>{t.k4h}</b> {t.k4}</li>
          <li><b>{t.k5h}</b> {t.k5}</li>
        </ul>
      </section>

      <section className="panel">
        <h2 className="h3">{t.contractsTitle}</h2>
        <p className="muted small">{t.contractsIntro}</p>
        <table className="contracts">
          <tbody>
            {[
              [t.cVault, VAULT_ADDRESS, true],
              [t.cMarket, MARKET_ADDRESS],
              [t.cGov, GOVERNOR_ADDRESS],
              [t.cTreasury, TREASURY_ADDRESS],
            ].map(([name, a, main]) => (
              <tr key={a} className={main ? 'main' : ''}>
                <th>{name}</th>
                <td>
                  <span className="mono-sm">{a}</span>
                  <span className="links">
                    <a href={`${EXPLORER}/address/${a}`} target="_blank" rel="noreferrer">BscScan ↗</a>
                    <a href={SOURCIFY(a)} target="_blank" rel="noreferrer">{t.verified} ↗</a>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          {t.source} <a href="https://github.com/kingtiong/legacy" target="_blank" rel="noreferrer">github.com/kingtiong/legacy</a>
        </p>
      </section>

      <section className="panel summary">
        <h2 className="h3">{t.confirmTitle}</h2>
        {[t.c1(unlockText), t.c2, t.c3, t.c4(shortAddress(VAULT_ADDRESS))].map((text, i) => (
          <label className="check" key={i}>
            <input type="checkbox" checked={ticks[i]} onChange={(e) => setTicks(ticks.map((v, j) => (j === i ? e.target.checked : v)))} />
            <span>{text}</span>
          </label>
        ))}
        {!all && <p className="hint">{t.tickAll}</p>}
        {onAccept(all)}
        {children}
      </section>
    </div>
  );
}

const en = {
  back: '← Change amount',
  title: 'Review before you lock',
  intro: 'Read this carefully. Once your wallet confirms, the deposit cannot be undone by anyone.',
  from: 'From wallet',
  amount: 'Deposit',
  retirement: 'Retirement part',
  emergency: 'Emergency part',
  unlocks: 'Unlocks',
  network: 'Network',
  testNote: 'test edition: 10 years is shortened to 10 hours',
  rulesTitle: 'The rules written in the smart contract',
  lock: 'Locked for 10 years.',
  lockTest: 'Locked for 10 years (10 hours in this test edition).',
  lockBody: (d) => `Your whole deposit unlocks on ${d}. Before that, nobody can withdraw it: not you, not the team, not a DAO vote, not for any fee.`,
  r1h: 'Retirement part (70%) cannot move at all.',
  r1: 'It cannot be withdrawn, sold, transferred or used as collateral until it unlocks.',
  r2h: 'Emergency part (30%) is the only early exit, and it is not guaranteed.',
  r2: 'You can only sell it to another person through the Decadium market, paid in USDT or USDC, at a price a buyer offers. Expect a discount to its BNB value, possibly a large one, and there may be no buyer at all. After you accept an offer you have 7 days to cancel; after that the sale is final. The market closes 7 days before your unlock date.',
  r3h: 'Staking.',
  r3: 'Deposits are staked with BNB Chain validators once 1 BNB or more is waiting. You keep 70% of the rewards, compounding inside your shares; 30% goes to the Decadium DAO treasury. Rewards vary and are not guaranteed.',
  r4h: 'After unlock.',
  r4: 'Nothing happens automatically. Claim all or part whenever you like. It is paid straight away if the vault holds enough unstaked BNB, otherwise after about 7 days while BNB Chain unstakes it.',
  r5h: 'Your shares are your votes.',
  r5: 'While you hold them, you can vote on how the DAO spends its fee income and which validators are used. No vote can touch deposits.',
  r6h: 'No owner, no pause, no upgrade.',
  r6: 'The contracts cannot be changed, paused or reversed by anyone, including the team.',
  r7h: 'Limits.',
  r7: (min, max) => `Each deposit must be between ${min} and ${max}. The whole pool has a cap that rises over time.`,
  riskTitle: 'Risks you accept',
  k1h: 'Not audited.',
  k1: 'The contracts have been tested but not independently audited. A bug could cause losses shared by all depositors.',
  k2h: 'BNB price.',
  k2: 'Your deposit is in BNB. If BNB falls, your ladder falls with it. There is no guaranteed return.',
  k3h: 'Your keys.',
  k3: 'Whoever controls this wallet owns the deposit. If you lose your keys or seed phrase, nobody can recover it.',
  k4h: 'BNB Chain.',
  k4: 'Staking depends on BNB Chain’s own system contracts, which BNB Chain governance can pause or change.',
  k5h: 'Your local rules.',
  k5: 'The contracts are open to anyone. Whether you may use them depends on the law where you live. Nothing here is financial advice.',
  contractsTitle: 'Smart contract details',
  contractsIntro: 'Your BNB goes to the vault below. Check the address in your wallet’s confirmation screen matches. All contracts are verified: the code running on BNB Chain matches the public source.',
  cVault: 'Vault (you send BNB here)',
  cMarket: 'Market',
  cGov: 'DAO governor',
  cTreasury: 'DAO treasury',
  verified: 'Verified on Sourcify',
  source: 'Open-source code:',
  confirmTitle: 'Confirm',
  c1: (d) => `I understand this BNB is locked until ${d}, and nobody can unlock it early.`,
  c2: 'I understand that only the emergency part (30%) can be exited early, only by selling it to another person for USDT or USDC, likely at a discount, with no guaranteed buyer.',
  c3: 'I understand the contracts are unaudited and I could lose this deposit.',
  c4: (v) => `I checked that I am sending to the vault ${v} on BNB Smart Chain.`,
  tickAll: 'Tick all four boxes to continue.',
};

const zh = {
  back: '← 修改金额',
  title: '锁定前，请确认',
  intro: '请仔细阅读。钱包确认之后，这笔存款任何人都无法撤回。',
  from: '钱包地址',
  amount: '存入金额',
  retirement: '退休部分',
  emergency: '应急部分',
  unlocks: '解锁时间',
  network: '网络',
  testNote: '测试版：10 年缩短为 10 小时',
  rulesTitle: '写在智能合约里的规则',
  lock: '锁定 10 年。',
  lockTest: '锁定 10 年（此测试版为 10 小时）。',
  lockBody: (d) => `你的整笔存款在 ${d} 解锁。在那之前，没有人能提走：你不行、团队不行、DAO 投票不行，付任何费用也不行。`,
  r1h: '退休部分（70%）完全不能动。',
  r1: '解锁前不能提取、不能出售、不能转让，也不能拿去抵押。',
  r2h: '应急部分（30%）是唯一的提前退出方式，而且没有保证。',
  r2: '只能通过 Decadium 市场卖给别人，收 USDT 或 USDC，价格由买家出价决定。通常会低于它的 BNB 价值（折价），折扣可能很大，也可能完全没有买家。接受报价后有 7 天冷静期可以取消，之后交易就不能反悔。在你的解锁日前 7 天，市场会关闭。',
  r3h: '质押。',
  r3: '当等待中的 BNB 达到 1 BNB 或以上，存款会质押给 BNB Chain 验证节点。收益的 70% 归你，在份额里继续复利；30% 进入 Decadium DAO 金库。收益会变动，没有保证。',
  r4h: '解锁之后。',
  r4: '不会自动发生任何事。你可以随时领取全部或一部分。如果金库里有足够未质押的 BNB 就马上到账，否则需要大约 7 天等待 BNB Chain 解除质押。',
  r5h: '你的份额就是你的投票权。',
  r5: '持有期间，你可以投票决定 DAO 怎么使用手续费收入、使用哪些验证节点。任何投票都动不了存款。',
  r6h: '没有拥有者、不能暂停、不能升级。',
  r6: '任何人（包括团队）都不能修改、暂停或撤销这些合约。',
  r7h: '限额。',
  r7: (min, max) => `每笔存款必须在 ${min} 到 ${max} 之间。整个资金池有上限，会随时间提高。`,
  riskTitle: '你接受的风险',
  k1h: '未经审计。',
  k1: '合约经过测试，但还没有独立审计。如果有漏洞，所有存款人可能一起承担损失。',
  k2h: 'BNB 价格。',
  k2: '你的存款是 BNB。BNB 下跌，你的阶梯也跟着下跌。没有保证回报。',
  k3h: '你的私钥。',
  k3: '谁控制这个钱包，谁就拥有这笔存款。如果弄丢私钥或助记词，没有人能帮你找回。',
  k4h: 'BNB Chain。',
  k4: '质押依赖 BNB Chain 自己的系统合约，BNB Chain 的治理可以暂停或更改它们。',
  k5h: '你所在地的规定。',
  k5: '合约对所有人开放。你是否可以使用，取决于你所在地的法律。这里的内容都不是投资建议。',
  contractsTitle: '智能合约资料',
  contractsIntro: '你的 BNB 会发送到下面的金库合约。请确认钱包确认页面上的地址一致。所有合约都已公开验证：在 BNB Chain 上运行的代码与公开源代码一致。',
  cVault: '金库（BNB 发送到这里）',
  cMarket: '市场',
  cGov: 'DAO 治理',
  cTreasury: 'DAO 金库',
  verified: '已在 Sourcify 验证',
  source: '开源代码：',
  confirmTitle: '确认',
  c1: (d) => `我明白这笔 BNB 会锁定到 ${d}，没有人能提早解锁。`,
  c2: '我明白只有应急部分（30%）可以提前退出，而且只能卖给别人换 USDT 或 USDC，通常是折价，也不保证有买家。',
  c3: '我明白合约未经审计，我可能会损失这笔存款。',
  c4: (v) => `我已确认是发送到 BNB Smart Chain 上的金库 ${v}。`,
  tickAll: '勾选全部四项才能继续。',
};
