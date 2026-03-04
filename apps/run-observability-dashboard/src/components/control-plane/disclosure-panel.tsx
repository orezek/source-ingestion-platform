'use client';

import { useState, type ReactNode } from 'react';

export function DisclosurePanel({
  eyebrow,
  title,
  description,
  children,
  defaultOpen = false,
  testId,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children: ReactNode;
  defaultOpen?: boolean;
  testId?: string;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="operator-disclosure" data-testid={testId} data-open={isOpen ? 'true' : 'false'}>
      <button
        type="button"
        className="operator-disclosure__summary"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <div className="operator-disclosure__copy">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <span aria-level={3} className="operator-disclosure__title" role="heading">
            {title}
          </span>
          <p className="operator-disclosure__description">{description}</p>
        </div>
        <span aria-hidden="true" className="operator-disclosure__indicator">
          {isOpen ? '−' : '+'}
        </span>
      </button>
      {isOpen ? <div className="operator-disclosure__body">{children}</div> : null}
    </div>
  );
}
