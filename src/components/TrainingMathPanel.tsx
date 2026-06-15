import type { ReactNode } from "react";

type TrainingMathPanelProps = {
  title: string;
  children: ReactNode;
  note?: string;
};

const TrainingMathPanel = ({ title, children, note }: TrainingMathPanelProps): JSX.Element => (
  <section className="training-math-panel" aria-label={title}>
    <div className="training-math-header">
      <span className="training-math-badge">Training Mode</span>
      <h3>{title}</h3>
    </div>
    <div className="training-math-content">
      {children}
    </div>
    {note !== undefined && <div className="table-note">{note}</div>}
  </section>
);

export default TrainingMathPanel;
