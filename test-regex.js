const cmd = 'node /path/to/mock_script.js';
const tokens = cmd.match(/(?:[^\s"\']+|"[^"]*"|\'[^\']*\')+/g) || [cmd];
console.log(tokens);
