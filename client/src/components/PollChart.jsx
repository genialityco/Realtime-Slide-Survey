import { letter, plural } from '../letter.js';

// Slice colours for pie/donut charts (the first one is the slide's accent colour).
const PALETTE = ['var(--accent)', '#123f47', '#f59e0b', '#e11d48', '#7c3aed', '#16a34a', '#0ea5e9', '#f97316', '#64748b', '#a16207'];

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

/** Results chart: 'bar' (horizontal), 'column' (vertical), 'pie' or 'donut'. */
export default function PollChart({ results, chartType = 'bar' }) {
  if (chartType === 'pie' || chartType === 'donut') return <RoundChart results={results} donut={chartType === 'donut'} />;

  const max = Math.max(1, ...results.options.map((o) => o.votes));
  return (
    <div className={`chart chart--${chartType}`}>
      {results.options.map((o, i) => (
        <div key={o.id} className="chart__row">
          <span className="chart__label">
            <span className="letter">{letter(i)}</span>
            <span>{o.text}</span>
          </span>
          <span className="chart__track">
            <span
              className="chart__fill"
              style={
                chartType === 'column' ? { height: `${(o.votes / max) * 100}%` } : { width: `${(o.votes / max) * 100}%` }
              }
            />
          </span>
          <span className="chart__value">
            <b>{pct(o.votes, results.total)}%</b> <small>({o.votes})</small>
          </span>
        </div>
      ))}
      <div className="chart__total">{plural(results.total, 'voto')}</div>
    </div>
  );
}

/** SVG pie / donut with a legend. */
function RoundChart({ results, donut }) {
  const R = 50;
  const total = results.total;
  let angle = -Math.PI / 2;
  const point = (a) => [60 + R * Math.cos(a), 60 + R * Math.sin(a)];

  const slices = results.options.map((o, i) => {
    const sweep = total ? (o.votes / total) * Math.PI * 2 : 0;
    const start = angle;
    angle += sweep;
    return { o, i, start, sweep, color: PALETTE[i % PALETTE.length] };
  });

  return (
    <div className={`chart chart--round ${donut ? 'chart--donut' : ''}`}>
      <svg className="chart__svg" viewBox="0 0 120 120" role="img" aria-label="Resultados">
        {total === 0 && <circle cx="60" cy="60" r={R} fill="rgba(127,127,127,0.18)" />}
        {slices.map(({ o, start, sweep, color }) => {
          if (sweep <= 0) return null;
          if (sweep >= Math.PI * 2 - 1e-6) return <circle key={o.id} cx="60" cy="60" r={R} fill={color} />;
          const [x1, y1] = point(start);
          const [x2, y2] = point(start + sweep);
          const large = sweep > Math.PI ? 1 : 0;
          return (
            <path
              key={o.id}
              d={`M60 60 L${x1} ${y1} A${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`}
              fill={color}
              stroke="#fff"
              strokeWidth="0.8"
            />
          );
        })}
        {donut && <circle cx="60" cy="60" r={R * 0.58} fill="var(--donut-hole, #fff)" />}
        {donut && (
          <text x="60" y="60" textAnchor="middle" dominantBaseline="central" className="chart__center">
            {total}
          </text>
        )}
      </svg>
      <div className="chart__legend">
        {slices.map(({ o, i, color }) => (
          <div key={o.id} className="chart__legend-row">
            <span className="letter" style={{ background: color }}>
              {letter(i)}
            </span>
            <span className="chart__legend-text">{o.text}</span>
            <span className="chart__value">
              <b>{pct(o.votes, total)}%</b> <small>({o.votes})</small>
            </span>
          </div>
        ))}
        <div className="chart__total">{plural(total, 'voto')}</div>
      </div>
    </div>
  );
}
