import { randomUUID } from "node:crypto";

import {
  getInfrastructureDefinition,
  getInfrastructureDefinitions,
  getWarFactoryProductionTimePercent,
} from "../../lib/planet-infrastructure.js";
import { startPlanetConstructionAction } from "./actions.js";
import ConstructionFeedback from "./construction-feedback.js";

function durationLabel(seconds) {
  for (const [unit, length] of [["day", 86_400], ["hour", 3_600], ["minute", 60]]) {
    if (seconds >= length && seconds % length === 0) {
      const count = seconds / length;
      return `${count} ${unit}${count === 1 ? "" : "s"}`;
    }
  }

  return `${seconds} seconds`;
}

export function ConstructionFinishTime({ value }) {
  const label = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));

  return <time dateTime={value}>{label} UTC</time>;
}

function BuildingEffects({ building, definition }) {
  const facilities = building.key === "planetary-command"
    ? getInfrastructureDefinitions().filter((entry) => entry.key !== building.key)
    : [];
  const factoryTimeLevels = building.key === "war-factory"
    ? Array.from({ length: definition.maximumLevel }, (_, index) => index + 1)
      .filter((level) => getWarFactoryProductionTimePercent(level)
        < getWarFactoryProductionTimePercent(level - 1))
    : [];

  return (
    <>
      <p>{definition.description}</p>
      {building.key === "materials-extractor" ? (
        <p className="infrastructure-current-effect">
          Current production: <strong>{building.extractorRatePerHour} Materials / hour</strong>.
        </p>
      ) : null}
      {building.key === "war-factory" ? (
        <p className="infrastructure-current-effect">
          Future factory order time: <strong>{building.productionTimePercent}% of base</strong>.
          {" "}Materials costs stay unchanged. Bonuses do not stack.
        </p>
      ) : null}
      {facilities.length > 0 ? (
        <ul className="infrastructure-unlocks">
          {facilities.map((facility) => (
            <li key={facility.key}>
              <span>{facility.name}</span>
              <span className="infrastructure-unlock-status">
                Level {facility.minimumCommandLevel}
                {" · "}
                {building.level >= facility.minimumCommandLevel ? "Unlocked" : "Locked"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {building.unlocks.length > 0 ? (
        <details className="infrastructure-designs">
          <summary>
            Design unlocks ({building.unlocks.filter((entry) => entry.unlocked).length}
            /{building.unlocks.length})
          </summary>
          <ul className="infrastructure-unlocks">
            {building.unlocks.map((entry) => (
              <li key={entry.key}>
                <span>{entry.name}</span>
                <span className="infrastructure-unlock-status">
                  Level {entry.requiredLevel}{" · "}{entry.unlocked ? "Unlocked" : "Locked"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {factoryTimeLevels.length > 0 ? (
        <ul className="infrastructure-unlocks">
          {factoryTimeLevels.map((level) => (
            <li key={level}>
              <span>New orders take {getWarFactoryProductionTimePercent(level)}% of base time</span>
              <span className="infrastructure-unlock-status">
                Level {level}{" · "}{building.level >= level ? "Unlocked" : "Locked"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export default function PlanetInfrastructure({ planet, status }) {
  const { infrastructure } = planet;
  const active = infrastructure.activeConstruction;
  const planetPath = `/planets/${encodeURIComponent(planet.id)}`;

  return (
    <section className="planet-infrastructure" aria-labelledby="infrastructure-title">
      <div className="infrastructure-heading">
        <h2 id="infrastructure-title">Infrastructure</h2>
        <form action={`${planetPath}#infrastructure-title`} method="get">
          <button className="secondary-button" type="submit">Refresh status</button>
        </form>
      </div>
      <p>
        One construction order per planet at a time. Pay with stored Materials;
        claim earned production first if needed. Completed levels take effect
        automatically, including while you are offline. Refresh to see the latest status.
      </p>
      <p className="infrastructure-production-notice">
        Unit recruitment and ship production are not available yet.
        Their unlocked designs are shown for future production.
      </p>
      <ConstructionFeedback status={status} />
      {active ? (
        <div className="infrastructure-active-work" role="status">
          <h3>{active.fromLevel === 0 ? "Building" : "Upgrading"} {active.buildingName}</h3>
          <p>Target level {active.targetLevel}. The existing level remains in effect until completion.</p>
          <p>Finishes <ConstructionFinishTime value={active.completesAt} />.</p>
        </div>
      ) : (
        <p className="infrastructure-idle">No construction in progress.</p>
      )}
      <div className="infrastructure-grid">
        {infrastructure.buildings.map((building) => {
          const definition = getInfrastructureDefinition(building.key);

          return (
            <article
              className="infrastructure-building"
              data-building-key={building.key}
              key={building.key}
            >
              <div className="infrastructure-building-heading">
                <h3>{building.name}</h3>
                <span>Level {building.level} / {definition.maximumLevel}</span>
              </div>
              <BuildingEffects building={building} definition={definition} />
              {building.nextLevel === null ? (
                <p className="infrastructure-current-effect">Maximum level reached.</p>
              ) : (
                <div className="infrastructure-next-step">
                  <h4>Next: level {building.nextLevel}</h4>
                  <dl>
                    <div><dt>Cost</dt><dd>{building.cost} Materials</dd></div>
                    <div><dt>Time</dt><dd>{durationLabel(building.durationSeconds)}</dd></div>
                  </dl>
                  {building.key !== "planetary-command" ? (
                    <p>Requires completed Planetary Command level {building.requiredCommandLevel}.</p>
                  ) : null}
                  {building.canBuild ? (
                    <form action={startPlanetConstructionAction} className="infrastructure-build-form">
                      <input name="planetId" type="hidden" value={planet.id} />
                      <input name="infrastructureEpoch" type="hidden" value={planet.infrastructureEpoch} />
                      <input name="buildingKey" type="hidden" value={building.key} />
                      <input name="expectedLevel" type="hidden" value={building.level} />
                      <input name="operationKey" type="hidden" value={randomUUID()} />
                      <button className="primary-button" type="submit">
                        {building.level === 0 ? `Build ${building.name}` : `Upgrade ${building.name} to level ${building.nextLevel}`}
                      </button>
                    </form>
                  ) : (
                    <p className="infrastructure-blocked">{building.blockedReason}</p>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
