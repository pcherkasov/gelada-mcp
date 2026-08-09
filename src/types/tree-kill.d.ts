declare module 'tree-kill' {
  function treeKill(pid: number, signal?: string | number, callback?: (err?: Error) => void): void;
  export = treeKill;
}
