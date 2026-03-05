import Link from 'next/link';

type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function BreadcrumbNav({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumb-nav">
      {items.map((item, index) => {
        const isCurrent = index === items.length - 1;

        return (
          <span key={`${item.label}-${index}`} className="breadcrumb-nav__item">
            {isCurrent || !item.href ? (
              <span
                aria-current={isCurrent ? 'page' : undefined}
                className="breadcrumb-nav__current"
              >
                {item.label}
              </span>
            ) : (
              <Link href={item.href} className="breadcrumb-nav__link">
                {item.label}
              </Link>
            )}
            {isCurrent ? null : <span className="breadcrumb-nav__separator">/</span>}
          </span>
        );
      })}
    </nav>
  );
}
