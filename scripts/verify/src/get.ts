/** Read the value following a CLI flag off argv, or undefined when absent. */
export const get = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
