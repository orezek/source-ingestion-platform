type EmptyTrayProps = {
  label?: string;
  title: string;
  message?: string;
  className?: string;
};

export function EmptyTray({ label = 'System output', title, message, className }: EmptyTrayProps) {
  const classes = ['empty-tray', className].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <p className="empty-tray__label">{label}</p>
      <p className="empty-tray__title">{title}</p>
      {message ? <p className="empty-tray__message">{message}</p> : null}
    </div>
  );
}
