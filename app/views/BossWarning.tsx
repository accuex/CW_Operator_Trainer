'use client';
import { warningFrame } from '@/lib/arcade/warning';
export function BossWarning({width,elapsed,reduced}:{width:number;elapsed:number;reduced:boolean}){
  const f=warningFrame(elapsed,reduced);
  return <g className="guard-warning" aria-label="WARNING — BOSS APPROACHING" data-warning-elapsed={elapsed}>
    <rect x="0" y="-50" width={width} height="435" fill="#170814" opacity=".93"/>
    {[95,260].map((y,i)=><svg key={y} x="0" y={y} width={width} height="25" viewBox={`0 0 ${width} 25`} overflow="hidden" aria-hidden="true">
      <rect width={width} height="25" fill="#350e19"/>
      <g transform={`translate(${i?f.bandOffset-160:-f.bandOffset} 0)`}>
        {Array.from({length:Math.ceil(width/160)+2},(_,j)=><g key={j} transform={`translate(${j*160} 0)`}><path d="M0 25L18 0H29L11 25Z" fill="#fa4f49"/><text x="35" y="17" fill="#ff7b70" fontSize="12" fontWeight="800">WARNING</text></g>)}
      </g>
    </svg>)}
    <g transform={`translate(${width/2} 183) scale(${f.pulse})`} className={f.glow?'guard-warning-complete':undefined}>
      <text textAnchor="middle" fill="#ff6b60" fontSize="38" fontWeight="900" letterSpacing="3">{f.title}{f.titleCursor?'▏':''}</text>
    </g>
    <text x={width/2} y="219" textAnchor="middle" fill="#fff0eb" fontSize="17" letterSpacing="2">{f.subtitle}{f.subCursor?'▏':''}</text>
  </g>;
}
