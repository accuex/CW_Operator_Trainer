import { revealedIllustration } from '../../lib/english/illustrations';

export default function EnglishIllustration({ learningEntityId, meaningRevealed }: {
  learningEntityId: string; meaningRevealed: boolean;
}) {
  const illustration = revealedIllustration(learningEntityId, meaningRevealed);
  if (!illustration) return null;
  const small = illustration.variants[0];
  return <figure className="english-illustration" data-illustration={illustration.assetId}>
    {/* eslint-disable-next-line @next/next/no-img-element -- the width variants are pre-generated and served as-is through srcSet */}
    <img src={small.src}
      srcSet={illustration.variants.map(v => `${v.src} ${v.width}w`).join(', ')}
      sizes="(max-width: 700px) calc(100vw - 80px), (max-width: 1024px) calc(100vw - 420px), 600px"
      width={small.width} height={small.height} alt={illustration.alt}
      loading="lazy" decoding="async" />
    <figcaption>{illustration.caption}</figcaption>
  </figure>;
}
