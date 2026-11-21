'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { BUSINESS_TYPES, ENQUIRY_LIMITS as L, type BusinessType, type EnquiryRequest } from '@/lib/enquiry/types';

export interface PickerFragrance {
  id: string;
  name: string;
  volumes: { id: string; label: string; casePack: number }[];
}

interface Line {
  key: number;
  fragranceId: string;
  volumeId: string;
  cases: number;
}

const FALLBACK = 'We could not send your enquiry just now. Please try again in a moment.';

async function send(req: EnquiryRequest): Promise<{ ok: true; reference: string } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/enquiry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    const json = (await res.json()) as { reference?: string; error?: string };
    if (res.ok && typeof json.reference === 'string') return { ok: true, reference: json.reference };
    return { ok: false, error: typeof json.error === 'string' ? json.error : FALLBACK };
  } catch {
    return { ok: false, error: FALLBACK };
  }
}

export function EnquiryForm({ fragrances, initialFragranceId }: { fragrances: PickerFragrance[]; initialFragranceId?: string }) {
  const uid = useId();
  const f = (name: string) => `${uid}-${name}`;
  const byId = new Map(fragrances.map((x) => [x.id, x]));

  const firstLine = (fragranceId: string): Line => ({
    key: Date.now() + Math.random(),
    fragranceId,
    volumeId: byId.get(fragranceId)?.volumes[0]?.id ?? '',
    cases: 1,
  });

  const [lines, setLines] = useState<Line[]>(() =>
    initialFragranceId && byId.has(initialFragranceId) ? [firstLine(initialFragranceId)] : [],
  );
  const [pick, setPick] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState('');

  function addLine() {
    if (!pick || lines.length >= L.maxLines) return;
    setLines((ls) => [...ls, firstLine(pick)]);
    setPick('');
  }

  function patchLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === 'sending') return;
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? '');
    setState('sending');
    setError(null);
    const result = await send({
      company: text('company'),
      contactName: text('contactName'),
      email: text('email'),
      phone: text('phone'),
      city: text('city'),
      businessType: text('businessType') as BusinessType,
      storeWebsite: text('storeWebsite'),
      wantsSamples: form.get('wantsSamples') === 'on',
      message: text('message'),
      website: text('website'),
      items: lines.map((l) => ({ fragranceId: l.fragranceId, volumeId: l.volumeId, cases: l.cases })),
    });
    if (result.ok) {
      setReference(result.reference);
      setState('done');
      window.scrollTo({ top: 0 });
    } else {
      setError(result.error);
      setState('idle');
    }
  }

  if (state === 'done') {
    return (
      <div role="status" className="border border-ink bg-papier-deep p-8 sm:p-12">
        <p className="label-muted">Enquiry received</p>
        <h2 className="mt-3 text-4xl italic leading-tight">Thank you. Your enquiry is with us.</h2>
        <p className="mt-4 text-lg">
          Your reference is <strong className="font-label font-medium tracking-wide">{reference}</strong>. Keep it if you write to us about this enquiry.
        </p>
        <p className="mt-3 text-ink-muted">We reply by email. You can order any time on the order page.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/checkout" className="btn-primary">Order by the case</Link>
          <Link href="/collection" className="btn-quiet">Back to the collection</Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate={false} className="grid gap-12 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-8">
        <fieldset className="space-y-5">
          <legend className="font-display text-3xl italic">Your business</legend>
          <div>
            <label htmlFor={f('company')} className="field-label">Company *</label>
            <input id={f('company')} name="company" required maxLength={L.company} autoComplete="organization" className="field" />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor={f('contactName')} className="field-label">Contact name *</label>
              <input id={f('contactName')} name="contactName" required maxLength={L.name} autoComplete="name" className="field" />
            </div>
            <div>
              <label htmlFor={f('email')} className="field-label">Email *</label>
              <input id={f('email')} name="email" type="email" required maxLength={L.email} autoComplete="email" className="field" />
            </div>
            <div>
              <label htmlFor={f('phone')} className="field-label">Phone</label>
              <input id={f('phone')} name="phone" type="tel" maxLength={L.phone} autoComplete="tel" className="field" />
            </div>
            <div>
              <label htmlFor={f('city')} className="field-label">City or region</label>
              <input id={f('city')} name="city" maxLength={L.city} autoComplete="address-level2" className="field" />
            </div>
            <div>
              <label htmlFor={f('businessType')} className="field-label">Type of business *</label>
              <select id={f('businessType')} name="businessType" required defaultValue="" className="field">
                <option value="" disabled>Choose one</option>
                {BUSINESS_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={f('storeWebsite')} className="field-label">Your shop or site</label>
              <input id={f('storeWebsite')} name="storeWebsite" maxLength={L.website} placeholder="Address or @handle" className="field" />
            </div>
          </div>
          <div>
            <label htmlFor={f('message')} className="field-label">Anything we should know</label>
            <textarea id={f('message')} name="message" rows={4} maxLength={L.message} className="field" />
          </div>
          <label className="flex min-h-[44px] items-center gap-3">
            <input type="checkbox" name="wantsSamples" className="h-5 w-5 accent-bordeaux" />
            <span>I would like to smell samples first</span>
          </label>
          {/* Honeypot: hidden from people, irresistible to scripts. */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label htmlFor={f('website')}>Leave this field empty</label>
            <input id={f('website')} name="website" tabIndex={-1} autoComplete="off" />
          </div>
        </fieldset>
      </div>

      <aside className="h-fit border border-ink bg-papier-deep p-6 sm:p-8 lg:sticky lg:top-24">
        <h2 className="font-display text-3xl italic">Fragrances you are considering</h2>
        <p className="mt-1 text-sm text-ink-muted">Optional. Indicative cases only: no prices are involved at this stage.</p>

        {lines.length === 0 ? (
          <p className="mt-5 border border-dashed border-ink-muted p-4 text-sm text-ink-muted">Nothing chosen yet. Add one below, or just send the enquiry.</p>
        ) : (
          <ul className="mt-5 space-y-4">
            {lines.map((l) => {
              const fr = byId.get(l.fragranceId);
              return (
                <li key={l.key} className="border-t border-ink pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-display text-xl leading-tight">{fr?.name}</p>
                    <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="label min-h-[44px] px-1 text-bordeaux underline underline-offset-4" aria-label={`Remove ${fr?.name}`}>
                      Remove
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor={`${f('vol')}-${l.key}`} className="field-label">Volume</label>
                      <select id={`${f('vol')}-${l.key}`} value={l.volumeId} onChange={(e) => patchLine(l.key, { volumeId: e.target.value })} className="field">
                        {fr?.volumes.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`${f('cases')}-${l.key}`} className="field-label">Cases</label>
                      <input
                        id={`${f('cases')}-${l.key}`}
                        type="number"
                        min={1}
                        max={L.maxCases}
                        value={l.cases}
                        onChange={(e) => patchLine(l.key, { cases: Math.max(1, Math.min(L.maxCases, Math.floor(Number(e.target.value)) || 1)) })}
                        className="field"
                      />
                    </div>
                  </div>
                  <p className="label-muted mt-2">
                    {fr?.volumes.find((v) => v.id === l.volumeId)?.casePack} bottles per case
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {lines.length < L.maxLines ? (
          <div className="mt-6 border-t border-ink pt-5">
            <label htmlFor={f('pick')} className="field-label">Add a fragrance</label>
            <div className="flex gap-2">
              <select id={f('pick')} value={pick} onChange={(e) => setPick(e.target.value)} className="field">
                <option value="">Choose…</option>
                {fragrances.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <button type="button" onClick={addLine} disabled={!pick} className="btn-quiet shrink-0 px-4">Add</button>
            </div>
          </div>
        ) : null}

        <div aria-live="polite" className="mt-6">
          {error ? <p role="alert" className="border-l-4 border-bordeaux bg-white p-3 text-sm text-bordeaux">{error}</p> : null}
        </div>
        <button type="submit" disabled={state === 'sending'} className="btn-primary mt-4 w-full">
          {state === 'sending' ? 'Sending…' : 'Send trade enquiry'}
        </button>
        <p className="mt-3 text-xs text-ink-muted">We reply by email. We do not promise a reply time or a quote.</p>
      </aside>
    </form>
  );
}
