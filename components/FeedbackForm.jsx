'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { BASE_PATH } from '../lib/protocol';

const T = {
  en: {
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

/** Just the report form, with a language switch: linked from the test banner as "Report a problem". */
export function FeedbackPage() {
  const [lang, setLang] = useState('en');
  const t = T[lang];
  return (
    <section className="band band-tight">
      <div className="wrap guide">
        <div className="toggle lang-toggle">
          <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
          <button type="button" aria-pressed={lang === 'zh'} onClick={() => setLang('zh')}>中文</button>
        </div>
        <Feedback t={t} lang={lang} />
      </div>
    </section>
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
