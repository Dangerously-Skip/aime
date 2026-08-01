import { planById, seatPrice, type SetupData } from "../schemas";

type Props = {
  accountId: string;
  data: SetupData;
  onRestart: () => void;
};

export default function SetupComplete({ accountId, data, onRestart }: Props) {
  const plan = planById(data.billing.plan);
  const seats = data.team.invites.length + 1;

  return (
    <section className="card card--done" aria-labelledby="done-title">
      <div className="done__tick" aria-hidden="true">
        <svg viewBox="0 0 32 32" focusable="false">
          <path
            d="M9 16.5l5 5 10-11"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h1 id="done-title" className="done__title">
        {data.company.companyName} is ready
      </h1>
      <p className="done__body">
        We've created the account and emailed a receipt to {data.billing.billingEmail}.
      </p>

      <dl className="recap">
        <div>
          <dt>Account ID</dt>
          <dd>
            <code>{accountId}</code>
          </dd>
        </div>
        <div>
          <dt>Plan</dt>
          <dd>
            {plan.name} · £{seatPrice(data.billing.plan, data.billing.cycle)}/seat/month, billed{" "}
            {data.billing.cycle}
          </dd>
        </div>
        <div>
          <dt>Seats</dt>
          <dd>
            {seats} ({data.team.invites.length} invited
            {data.team.invites.length === 0 ? " — you can add people later" : ""})
          </dd>
        </div>
        <div>
          <dt>Billing country</dt>
          <dd>{data.company.country}</dd>
        </div>
      </dl>

      {data.team.invites.length > 0 && (
        <div className="recap__invites">
          <p className="recap__invitesTitle">Invitations sent to</p>
          <ul>
            {data.team.invites.map((invite) => (
              <li key={invite.email}>
                {invite.email} <span className="badge">{invite.role}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="actions actions--center">
        <button type="button" className="btn btn--primary" onClick={onRestart}>
          Set up another account
        </button>
      </div>
    </section>
  );
}
