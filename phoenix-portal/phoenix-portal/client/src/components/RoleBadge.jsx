/* Small colored pill for a user's custom job title (Tech 1/2/3, Lead, …).
   Renders nothing when the user has no assigned title. `role` is { name, color }
   as returned by useRoles(). */
export default function RoleBadge({ role, style }) {
    if (!role || !role.name) return null;
    return (
        <span
            title={role.name}
            style={{
                fontSize: 10, fontWeight: 600, lineHeight: 1.4, padding: '1px 6px',
                borderRadius: 8, color: '#fff', background: role.color || '#6b7280',
                whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'middle',
                ...style,
            }}
        >
            {role.name}
        </span>
    );
}
