type ResourceLifecycleActionsProps = {
  id: string;
  deleteAction: (formData: FormData) => Promise<void>;
  deleteDisabledReason?: string;
};

export function ResourceLifecycleActions({
  id,
  deleteAction,
  deleteDisabledReason,
}: ResourceLifecycleActionsProps) {
  return (
    <div className="resource-card__actions">
      {deleteDisabledReason ? (
        <p className="empty-copy">{deleteDisabledReason}</p>
      ) : (
        <form action={deleteAction}>
          <input type="hidden" name="id" value={id} />
          <button type="submit">Delete</button>
        </form>
      )}
    </div>
  );
}
