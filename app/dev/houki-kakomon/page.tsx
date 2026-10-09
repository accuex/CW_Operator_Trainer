import { redirect } from 'next/navigation';

/** Old development URL. The player now lives in the app. */
export default function HoukiKakomonPage() {
  redirect('/app/houki-kakomon');
}
