type ResourceLifecycleActionsProps = {
  id: string;
  deleteAction: (formData: FormData) => Promise<void>;
};

export function ResourceLifecycleActions({ id, deleteAction }: ResourceLifecycleActionsProps) {
  return (
    <div className="resource-card__actions">
      <form action={deleteAction}>
        <input type="hidden" name="id" value={id} />
        <button type="submit">Delete</button>
      </form>
    </div>
  );
}
