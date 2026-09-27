export default function UnitCard({ unit }) {
  return (
    <article className="unit-card">
      <div className="unit-card-heading">
        <p className="unit-category">{unit.category}</p>
        <h3>{unit.name}</h3>
      </div>

      <dl className="unit-summary">
        <div>
          <dt>Primary function</dt>
          <dd>{unit.primaryFunction}</dd>
        </div>
        <div>
          <dt>Battlefield roles</dt>
          <dd>
            <ul className="unit-role-list">
              {unit.battlefieldRoles.map((role) => (
                <li key={role}>{role}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt>{unit.scope === "general" ? "Design principle" : "Unique role"}</dt>
          <dd>
            {unit.scope === "general"
              ? unit.designPrinciple
              : unit.uniqueRole}
          </dd>
        </div>
      </dl>
    </article>
  )
}
