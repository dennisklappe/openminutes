import type { ReactNode } from 'react';
import { Brand } from '../Brand.js';
import { stepIds, stepLabels, type StepId } from './steps.js';

export function WizardFrame({
  current,
  title,
  intro,
  children,
}: {
  current: StepId;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  const index = stepIds.indexOf(current);
  return (
    <div className="wizard">
      <Brand />
      <ol className="stepper" aria-label="Setup progress">
        {stepIds.map((id, position) => (
          <li
            key={id}
            aria-current={position === index ? 'step' : undefined}
            data-done={position < index}
          >
            <span className="mono">{position + 1}</span>
            {stepLabels[id]}
          </li>
        ))}
      </ol>
      <h1>{title}</h1>
      <p className="muted">{intro}</p>
      {children}
    </div>
  );
}
