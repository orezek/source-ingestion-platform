'use client';

import { useState, type ReactNode } from 'react';

export function DisclosurePanel({
  title,
  description,
  children,
  defaultOpen = false,
  testId,
}: {
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
        <span className="operator-disclosure__title">{title}</span>
        <span className="operator-disclosure__description">{description}</span>
      </button>
      {isOpen ? <div className="operator-disclosure__body">{children}</div> : null}
    </div>
  );
}
