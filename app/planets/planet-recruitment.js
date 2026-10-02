import { randomUUID } from "node:crypto";

import {
  collectPlanetRecruitmentAction,
  startPlanetRecruitmentAction,
} from "./actions.js";
import { ConstructionFinishTime } from "./planet-infrastructure.js";
import RecruitmentFeedback from "./recruitment-feedback.js";

function durationLabel(seconds) {
  const text = String(seconds);

  if (!/^[0-9]+$/.test(text)) {
    return `${text} seconds`;
  }

  let remaining = BigInt(text);
  const parts = [];

  for (const [unit, length] of [["day", 86_400n], ["hour", 3_600n], ["minute", 60n], ["second", 1n]]) {
    const count = remaining / length;
    remaining %= length;

    if (count > 0n) {
      parts.push(`${count} ${unit}${count === 1n ? "" : "s"}`);
    }
  }

  return parts.join(" ") || "0 seconds";
}

export default function PlanetRecruitment({ planet, status }) {
  const { recruitment } = planet;
  const { order } = recruitment;
  const planetPath = `/planets/${encodeURIComponent(planet.id)}`;

  return (
    <section className="planet-recruitment" aria-labelledby="recruitment-title">
      <div className="recruitment-heading">
        <h2 id="recruitment-title">Recruitment</h2>
        <form action={`${planetPath}#recruitment-title`} method="get">
          <button className="secondary-button" type="submit">Refresh recruitment status</button>
        </form>
      </div>
      <h3>{recruitment.unitName}</h3>
      <dl className="recruitment-details">
        <div><dt>Cost per unit</dt><dd>{recruitment.costPerUnit} Materials</dd></div>
        <div><dt>Time per unit</dt><dd>{durationLabel(recruitment.durationSecondsPerUnit)}</dd></div>
      </dl>
      <p id="recruitment-rules">
        Requires completed {recruitment.requiredBuildingName} level {recruitment.requiredBuildingLevel}.
        {" "}Pay for the whole batch with stored Materials. Recruitment continues offline and can run alongside construction.
        One order per planet; collect a ready order before starting another.
      </p>
      <RecruitmentFeedback status={status} />
      {order ? (
        <div className="recruitment-order" role="status">
          <h3>{order.status === "ready" ? "Ready to collect" : order.status === "collected" ? "Collected" : "Recruiting"}</h3>
          <dl className="recruitment-details">
            <div><dt>Batch</dt><dd>{order.quantity} {recruitment.unitName}</dd></div>
            <div><dt>Materials paid</dt><dd>{order.materialsCost} Materials</dd></div>
            <div><dt>Total time</dt><dd>{durationLabel(order.durationSeconds)}</dd></div>
            <div><dt>Finishes</dt><dd><ConstructionFinishTime value={order.completesAt} /></dd></div>
          </dl>
          {order.status === "collected" ? (
            <p>Collected <ConstructionFinishTime value={order.collectedAt} />.</p>
          ) : (
            <p>The whole batch joins Planetary forces only after you collect it.</p>
          )}
          {order.status === "ready" ? (
            <form action={collectPlanetRecruitmentAction} className="recruitment-collect-form">
              <input name="planetId" type="hidden" value={planet.id} />
              <input name="infrastructureEpoch" type="hidden" value={planet.infrastructureEpoch} />
              <input name="orderId" type="hidden" value={order.id} />
              <button className="primary-button" type="submit">Collect recruits</button>
            </form>
          ) : null}
        </div>
      ) : null}
      {recruitment.canRecruit ? (
        <form action={startPlanetRecruitmentAction} className="recruitment-start-form">
          <input name="planetId" type="hidden" value={planet.id} />
          <input name="infrastructureEpoch" type="hidden" value={planet.infrastructureEpoch} />
          <input name="operationKey" type="hidden" value={randomUUID()} />
          <label htmlFor="recruitment-quantity">Number of units</label>
          <input
            aria-describedby="recruitment-rules"
            defaultValue="1"
            id="recruitment-quantity"
            inputMode="numeric"
            name="quantity"
            pattern="[1-9][0-9]*"
            required
            type="text"
          />
          <button className="primary-button" type="submit">Recruit {recruitment.unitName}</button>
        </form>
      ) : (
        <p className="recruitment-blocked">{recruitment.blockedReason}</p>
      )}
    </section>
  );
}
