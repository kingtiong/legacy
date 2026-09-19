'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAccount } from 'wagmi';
import { BASE_PATH } from '../lib/protocol';

const T = {
  en: {
    eyebrow: 'Test edition',
    title: 'How to test Decadium',
    lead: 'This is the real product with one change: a deposit is locked for 10 hours instead of 10 years. It uses real BNB on BNB Chain, so only use a small amount.',
    needTitle: 'What you need',
    need: [
      'A wallet app: MetaMask, Trust Wallet, Binance Web3 Wallet, OKX or TokenPocket.',
      'About 0.02 BNB on BNB Smart Chain (BEP20): 0.01 to deposit, the rest for small network fees.',
    ],
    stepsTitle: 'Steps',
    steps: [
      ['Open the app', 'Tap Deposit at the top. On a phone, tap "Open in MetaMask" or "Open in Trust Wallet" so the page opens inside your wallet. In other wallet apps, paste decadium.club/test into the wallet’s own browser.'],
      ['Connect', 'Tap Connect wallet. If asked, switch to BNB Smart Chain.'],
      ['Deposit', 'Enter 0.01 (at most 0.05). Choose your split, tick the box, tap Lock, and confirm in your wallet.'],
      ['Check your ladder', 'Open My ladder. You should see your rung and the time it unlocks, about 10 hours later.'],
      ['Claim', 'After it unlocks, tap Claim, then Claim BNB.'],
      ['Withdraw', 'Tap Withdraw to my wallet. The BNB should arrive in your wallet straight away.'],
    ],
    note: 'The market’s 7-day cooling-off and DAO votes keep their real timing, so they cannot be finished within 10 hours. The whole test pool holds at most 1 BNB; if it is full, try again later.',
    risk: 'Test contracts are unaudited. Deposit only a small amount you are comfortable with.',
    go: 'Start: make a test deposit',
    fbTitle: 'Tell us how it went',
    step: 'Which step?',
    stepNames: { connect: 'Connect wallet', deposit: 'Deposit', ladder: 'My ladder', claim: 'Claim', withdraw: 'Withdraw', other: 'Other' },
    result: 'Result',
    ok: 'It worked',
    bad: 'I had a problem',
    message: 'What happened? (wallet app, phone, any error message)',
    contact: 'Telegram or email, if you want a reply (optional)',
    send: 'Send',
    sending: 'Sending…',
    thanks: 'Thank you. Your report was received.',
  },
  zh: {
    eyebrow: '测试版',
    title: '如何测试 Decadium',
    lead: '这是真正的产品，只改了一样：每笔存款锁 10 个小时，而不是 10 年。使用的是 BNB Chain 上的真实 BNB，所以请只用小额。',
    needTitle: '你需要准备',
    need: [
      '一个钱包App：MetaMask、Trust Wallet、Binance Web3 钱包、OKX 或 TokenPocket。',
      '大约 0.02 BNB（BNB Smart Chain / BEP20）：0.01 用来存入，其余用来付少量手续费。',
    ],
    stepsTitle: '步骤',
    steps: [
      ['打开App', '点上方的 Deposit。用手机的话，点“Open in MetaMask”或“Open in Trust Wallet”，让页面在钱包里打开。其他钱包App，请在钱包自带的浏览器里输入 decadium.club/test。'],
      ['连接钱包', '点 Connect wallet。如果提示，切换到 BNB Smart Chain。'],
      ['存入', '输入 0.01（最多 0.05）。选比例，勾选确认框，点 Lock，然后在钱包里确认。'],
      ['查看阶梯', '打开 My ladder，应该看到你的那一格，以及大约 10 小时后的解锁时间。'],
      ['领取', '解锁之后，点 Claim，再点 Claim BNB。'],
      ['提回钱包', '点 Withdraw to my wallet，BNB 应该马上回到你的钱包。'],
    ],
    note: '市场的 7 天冷静期和 DAO 投票保持真实时间，所以 10 小时内无法完成。整个测试池最多 1 BNB，如果满了，请稍后再试。',
    risk: '测试合约未经审计。只存你可以接受的小额。',
    go: '开始：做一次测试存款',
    fbTitle: '告诉我们结果',
    step: '哪一个步骤？',
    stepNames: { connect: '连接钱包', deposit: '存入', ladder: '我的阶梯', claim: '领取', withdraw: '提回钱包', other: '其他' },
    result: '结果',
    ok: '成功了',
    bad: '遇到问题',
    message: '发生了什么？（钱包App、手机型号、任何错误信息）',
    contact: 'Telegram 或 email，如果想要回复（可不填）',
    send: '提交',
    sending: '提交中…',
    thanks: '谢谢！我们收到你的反馈了。',
  },
};

export default function TesterGuide() {
  const [lang, setLang] = useState('en');
  const t = T[lang];
  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <div className="toggle lang-toggle">
            <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
            <button type="button" aria-pressed={lang === 'zh'} onClick={() => setLang('zh')}>中文</button>
          </div>
          <p className="eyebrow">{t.eyebrow}</p>
          <h1>{t.title}</h1>
          <p className="lead">{t.lead}</p>
          <div className="cta-row" style={{ marginTop: '1.4rem' }}>
            <Link className="btn lg" href="/app/deposit">{t.go}</Link>
          </div>
        </div>
      </section>
      <section className="band band-tight">
        <div className="wrap guide">
          <div className="panel">
            <h2 className="h3">{t.needTitle}</h2>
            <ul>{t.need.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
          <div className="panel">
            <h2 className="h3">{t.stepsTitle}</h2>
            <ol className="guide-steps">
              {t.steps.map(([h, b]) => (
                <li key={h}><b>{h}.</b> {b}</li>
              ))}
            </ol>
            <p className="notice">{t.note}</p>
            <p className="formmsg err" style={{ marginTop: '.4rem' }}>{t.risk}</p>
          </div>
          <Feedback t={t} lang={lang} />
        </div>
      </section>
    </>
  );
}

function Feedback({ t, lang }) {
  const { address } = useAccount();
  const [step, setStep] = useState('deposit');
  const [worked, setWorked] = useState(true);
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [state, setState] = useState({ status: 'idle', error: '' });

  async function submit(e) {
    e.preventDefault();
    setState({ status: 'sending', error: '' });
    try {
      const res = await fetch(`${BASE_PATH}/api/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ step, worked, message, contact, wallet: address || '', lang }),
      });
      const data = await res.json();
      if (!res.ok) return setState({ status: 'idle', error: data.error || 'Something went wrong.' });
      setState({ status: 'done', error: '' });
    } catch {
      setState({ status: 'idle', error: 'Network error. Please try again.' });
    }
  }

  if (state.status === 'done') {
    return <div className="panel" id="feedback"><p className="formmsg ok">{t.thanks}</p></div>;
  }
  return (
    <form className="panel" id="feedback" onSubmit={submit}>
      <h2 className="h3">{t.fbTitle}</h2>
      <div className="field">
        <label htmlFor="fb-step">{t.step}</label>
        <select id="fb-step" value={step} onChange={(e) => setStep(e.target.value)}>
          {Object.entries(t.stepNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="field">
        <label>{t.result}</label>
        <div className="toggle">
          <button type="button" aria-pressed={worked} onClick={() => setWorked(true)}>{t.ok}</button>
          <button type="button" aria-pressed={!worked} onClick={() => setWorked(false)}>{t.bad}</button>
        </div>
      </div>
      <div className="field">
        <label htmlFor="fb-msg">{t.message}</label>
        <textarea id="fb-msg" rows={4} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="fb-contact">{t.contact}</label>
        <input id="fb-contact" type="text" maxLength={190} value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="off" />
      </div>
      {state.error && <p className="formmsg err">{state.error}</p>}
      <button type="submit" className="btn" disabled={state.status === 'sending'}>
        {state.status === 'sending' ? t.sending : t.send}
      </button>
    </form>
  );
}
