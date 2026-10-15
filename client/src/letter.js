/** A, B, C… for option index i. */
export const letter = (i) => String.fromCharCode(65 + i);

/** "1 voto", "3 votos" */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
