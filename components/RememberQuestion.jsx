'use client';

import { useEffect } from 'react';
import { QUESTION_COOKIE } from '../lib/questions';

// Records which question this visitor just saw, so the next visit shows a
// different one. Runs only when the page is actually shown, never on a prefetch.
export default function RememberQuestion({ index }) {
  useEffect(() => {
    document.cookie = `${QUESTION_COOKIE}=${index}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
  }, [index]);
  return null;
}
