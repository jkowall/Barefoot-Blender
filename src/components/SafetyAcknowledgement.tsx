type SafetyAcknowledgementProps = {
  onAcknowledge: () => void;
};

const SafetyAcknowledgement = ({ onAcknowledge }: SafetyAcknowledgementProps): JSX.Element => (
  <div className="blocking-screen">
    <div className="card blocking-card">
      <img className="blocking-logo" src="/logo-192.png" alt="Barefoot Blender logo" />
      <h1>Safety acknowledgement</h1>
      <p>
        Barefoot Blender is for trained divers and fill station operators. It is a planning aid, not a
        substitute for formal gas blending training, agency procedures, or shop policy.
      </p>
      <p>
        Always analyze the final cylinder with a calibrated oxygen and helium analyzer before diving.
        Incorrect gas blending can cause serious injury or death.
      </p>
      <button className="calculate-button" type="button" onClick={onAcknowledge}>
        I understand
      </button>
    </div>
  </div>
);

export default SafetyAcknowledgement;
