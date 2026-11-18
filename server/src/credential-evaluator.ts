import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as common from "@zxcvbn-ts/language-common";
import * as english from "@zxcvbn-ts/language-en";
import * as portuguese from "@zxcvbn-ts/language-pt-br";
import type {
  CredentialPolicy,
  PasswordEvaluation,
  PasswordRequirementReason,
} from "./credential-policy-contract.js";

export const CREDENTIAL_EVALUATOR_VERSION =
  "orgmap-zxcvbn4.2.0-common4.1.3-en4.1.1-pt4.1.1-v1";
const estimator = new ZxcvbnFactory({
  translations: english.translations,
  graphs: common.adjacencyGraphs,
  dictionary: {
    ...common.dictionary,
    ...english.dictionary,
    ...portuguese.dictionary,
  },
});
const minimumScore = { LOW: 1, MEDIUM: 2, HIGH: 3 } as const;

/** Plaintext is transient. Return only the minimal compliance verdict. */
export function evaluateCredentialPassword(
  password: string,
  policy: Pick<CredentialPolicy, "complexity" | "strength">,
  userInputs: string[] = [],
): PasswordEvaluation {
  const reasons: PasswordRequirementReason[] = [];
  if (
    policy.complexity &&
    ([...password].length < 8 ||
      !/\p{Lu}/u.test(password) ||
      !/\p{Ll}/u.test(password) ||
      !/[^\p{L}\p{N}\s]/u.test(password))
  )
    reasons.push("PASSWORD_COMPLEXITY_REQUIRED");
  if (
    estimator.check(password, userInputs).score < minimumScore[policy.strength]
  )
    reasons.push("PASSWORD_STRENGTH_REQUIRED");
  return {
    evaluatorVersion: CREDENTIAL_EVALUATOR_VERSION,
    passed: reasons.length === 0,
    reasons,
  };
}
