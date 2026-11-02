import React from 'react';
import { MapPin } from 'lucide-react';
import { useSectionText } from '../../i18n/useSectionText';
import { REGIONAL_TEXT } from './regional-i18n';

// Driver identity and consent are verified in Telegram; a public order URL must
// not grant permission to inject coordinates or finish somebody else's trip.
export const DriverGpsTracker: React.FC = () => {
  const { text } = useSectionText(REGIONAL_TEXT);
  const order = new URLSearchParams(window.location.search).get('order') || '';
  const botLink = `https://t.me/SilkRoadDriverBot${order ? '?start=' + encodeURIComponent(order) : ''}`;
  return <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
    <section className="max-w-md rounded-2xl bg-white p-8 shadow-sm space-y-5 text-slate-900">
      <MapPin className="text-blue-600 w-10 h-10" />
      <h1 className="text-xl font-bold">{text.driverPage.title}</h1>
      <p>{text.driverPage.step1}</p>
      <p>{text.driverPage.step2}</p>
      <a href={botLink} className="block rounded-lg bg-blue-600 p-3 text-center font-semibold text-white">{text.driverPage.openBot}</a>
    </section>
  </main>;
};
