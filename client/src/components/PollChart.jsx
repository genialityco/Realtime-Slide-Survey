import { letter, plural } from '../letter.js';

export default function PollChart({ results, chartType = 'bar' }) {
  const max = Math.max(1, ...results.options.map((o) => o.votes));
  const pct = (n) => (results.total ? Math.round((n / results.total) * 100) : 0);
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
            <b>{pct(o.votes)}%</b> <small>({o.votes})</small>
          </span>
        </div>
      ))}
      <div className="chart__total">{plural(results.total, 'voto')}</div>
    </div>
  );
}
