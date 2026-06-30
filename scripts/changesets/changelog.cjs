const renderCommit = (commit, repo) => {
  if (!commit) {
    return '';
  }
  const short = commit.slice(0, 7);
  if (!repo) {
    return `${short}: `;
  }
  return `[\`${short}\`](https://github.com/${repo}/commit/${commit}): `;
};

const getReleaseLine = async (changeset, _type, options = {}) => {
  const [firstLine = '', ...rest] = changeset.summary
    .split('\n')
    .map((line) => line.trimEnd());
  let output = `- ${renderCommit(changeset.commit, options.repo)}${firstLine}`;

  if (rest.length > 0) {
    output += `\n${rest.map((line) => `  ${line}`).join('\n')}`;
  }

  return output;
};

const getDependencyReleaseLine = async (_changesets, dependenciesUpdated) => {
  const externalDependencies = dependenciesUpdated.filter(
    (dependency) => !dependency.name.startsWith('@ontrails/')
  );

  if (externalDependencies.length === 0) {
    return '';
  }

  return externalDependencies
    .map(
      (dependency) =>
        `- Updated dependency ${dependency.name}@${dependency.newVersion}`
    )
    .join('\n');
};

module.exports = {
  getDependencyReleaseLine,
  getReleaseLine,
};
