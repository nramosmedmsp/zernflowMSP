import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [...nextVitals, { ignores: ["**/*.d.mts"] }];

export default eslintConfig;
