import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'دوكو | DUKO CLUB',
  description: 'طاولة دوكو للشلّة. غرف، كرامات وحرق سريع من أي جهاز.',
  icons: { icon: '/icon.svg' }, manifest: '/manifest.webmanifest',
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
