'use client';
/* eslint-disable @next/next/no-html-link-for-pages -- 本番(vinext)では next/link のクライアント遷移が落ちるため通常の <a> を使う */

import { useState, type FormEvent } from 'react';
import { Icon } from '@/app/components/icons';
import { ApiError, sendContact, type ContactCategory } from '@/lib/api/client';

const CATEGORIES: { id: ContactCategory; label: string }[] = [
  { id: 'question', label: '使い方の質問' },
  { id: 'bug', label: '不具合の報告' },
  { id: 'request', label: '機能の要望' },
  { id: 'account', label: 'アカウント・同期' },
  { id: 'other', label: 'その他' },
];

const MESSAGE_MIN = 10;
const MESSAGE_MAX = 4000;

type Fields = 'name' | 'email' | 'category' | 'message';
type Status = 'idle' | 'sending' | 'sent';

export function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState<ContactCategory | ''>('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errors, setErrors] = useState<Partial<Record<Fields, string>>>({});
  const [formError, setFormError] = useState('');

  const validate = () => {
    const next: Partial<Record<Fields, string>> = {};
    if (!name.trim()) next.name = 'お名前を入力してください';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'メールアドレスの形式を確認してください';
    if (!category) next.category = 'お問い合わせの種類を選んでください';
    const length = message.trim().length;
    if (length < MESSAGE_MIN) next.message = `内容は${MESSAGE_MIN}文字以上で入力してください`;
    else if (length > MESSAGE_MAX) next.message = `内容は${MESSAGE_MAX}文字以内で入力してください`;
    return next;
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length || !category) return;

    setStatus('sending');
    try {
      await sendContact({ name: name.trim(), email: email.trim(), category, message: message.trim(), website });
      setStatus('sent');
    } catch (error) {
      setStatus('idle');
      if (error instanceof ApiError && error.status === 422) {
        const fields = (error.body as { fields?: Partial<Record<Fields, string>> } | null)?.fields;
        if (fields) setErrors(fields);
        setFormError('入力内容を確認してください。');
      } else if (error instanceof ApiError && error.status === 429) {
        setFormError('短時間に送信が続いたため、受け付けを止めています。しばらくしてからもう一度お試しください。');
      } else {
        setFormError('送信できませんでした。時間をおいてもう一度お試しください。');
      }
    }
  };

  if (status === 'sent') {
    return (
      <div className="contact-done panel panel-pad" role="status">
        <span className="contact-done-icon" aria-hidden="true"><Icon name="check" size={28} /></span>
        <h2>送信しました</h2>
        <p>お問い合わせありがとうございます。内容を確認のうえ、必要に応じてご返信します。</p>
        <p className="contact-note">送信内容の控えメールはお送りしていません。</p>
        <a className="btn btn-ghost" href="/">トップへ戻る</a>
      </div>
    );
  }

  const fieldProps = (field: Fields) => ({
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `contact-${field}-error` : undefined,
  });
  const fieldError = (field: Fields) => errors[field] && <small id={`contact-${field}-error`} className="contact-error">{errors[field]}</small>;

  return (
    <form className="contact-form panel panel-pad" onSubmit={onSubmit} noValidate>
      <label className="contact-field">
        <span>お名前<em>必須</em></span>
        <input type="text" name="name" autoComplete="name" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} {...fieldProps('name')} />
        {fieldError('name')}
      </label>

      <label className="contact-field">
        <span>メールアドレス<em>必須</em></span>
        <input type="email" name="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} {...fieldProps('email')} />
        {fieldError('email')}
      </label>

      <label className="contact-field">
        <span>お問い合わせの種類<em>必須</em></span>
        <select name="category" value={category} onChange={(event) => setCategory(event.target.value as ContactCategory | '')} {...fieldProps('category')}>
          <option value="">選んでください</option>
          {CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        {fieldError('category')}
      </label>

      <label className="contact-field">
        <span>内容<em>必須</em></span>
        <textarea name="message" rows={8} value={message} onChange={(event) => setMessage(event.target.value)} {...fieldProps('message')} />
        <span className="contact-count">{message.trim().length} / {MESSAGE_MAX}</span>
        {fieldError('message')}
      </label>

      {/* Honeypot: hidden from people, filled in by naive bots. */}
      <label className="contact-trap" aria-hidden="true">
        Website
        <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
      </label>

      <p className="contact-note">いただいた内容は、お問い合わせへの返信のためだけに使います。送信内容の控えメールは届きません。</p>
      {formError && <p className="contact-error form" role="alert">{formError}</p>}

      <button type="submit" className="btn btn-primary contact-submit" disabled={status === 'sending'}>
        {status === 'sending' ? '送信中…' : '送信する'}
        {status !== 'sending' && <Icon name="chevron-right" size={16} />}
      </button>
    </form>
  );
}
