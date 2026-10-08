export default function GeographyLoading({ completed, total, onBack }: { completed?: number; total?: number; onBack: () => void }) {
    return <section className="page-pad geography-page geo-loading-page" aria-busy="true">
        <div className="geo-loading-card panel">
            <div className="geo-loading-art" aria-hidden="true">
                <svg viewBox="0 0 180 120" fill="none">
                    <path d="M25 32 68 20l44 13 43-12v68l-43 13-44-14-43 13V32Z" />
                    <path d="M68 20v68m44-55v69" />
                    <path className="geo-loading-route" d="M44 77c14-28 30-16 43-30s29-7 48 15" />
                    <circle cx="44" cy="77" r="4" />
                    <path className="geo-loading-pin" d="M105 46c0-11 9-20 20-20s20 9 20 20c0 15-20 31-20 31s-20-16-20-31Z" />
                    <circle className="geo-loading-pin" cx="125" cy="46" r="6" />
                </svg>
            </div>
            <p className="section-kicker">一総通 · 地理</p>
            <h1>地図を準備しています</h1>
            <p className="geo-loading-description">地点・地形・出題履歴を読み込んでいます。<br />もう少しで、地図から学習を始められます。</p>
            <div className="geo-loading-progress">
                <div className="geo-loading-count" role="status" aria-live="polite" aria-atomic="true">
                    <span>{completed === undefined ? '学習画面の準備' : '教材ファイルの準備'}</span><strong>{completed === undefined ? '準備中' : <>{completed} <span>/ {total}</span></>}</strong>
                </div>
                <progress max={total} value={completed} aria-label="教材ファイルの準備" />
            </div>
            <p className="geo-loading-hint">初回は地図データの取得に時間がかかることがあります。<br />読み込みが終わると、学習画面が開きます。</p>
            <button className="btn btn-secondary" onClick={onBack}>一総通へ戻る</button>
        </div>
    </section>;
}
