/* ============================================================
   BESTAND: dept_merge_v1.js  
   KOPIEER NAAR: src/lib/dept-merge.js
   (NIEUWE file, maak src/lib directory als die nog niet bestaat)

   Helper voor het samenvoegen van dept_code 12 → 11.
   Bij omzet zijn deze al samengevoegd; voor de voorraad-rapporten
   willen we dezelfde behandeling.

   Strategie: alle rijen waar dept_code === '12' krijgen dept_code '11'.
   dept_name wordt overschreven met de bekende naam van afdeling 11
   (als die in de dataset voorkomt), anders blijft de oorspronkelijke
   naam staan.

   USAGE:
     import { mergeDeptElevenTwelve } from '@/lib/dept-merge';

     const rows = await supabase.from('buying_data').select('*');
     const merged = mergeDeptElevenTwelve(rows.data);
   ============================================================ */

/**
 * Roll dept_code '12' rows onto '11'. Mutation-free.
 * - Picks the dept_name of code '11' if present in the input,
 *   otherwise leaves dept_name untouched.
 * @param {Array<Object>} rows Rows with dept_code (string) and dept_name (string).
 * @returns {Array<Object>} New array with merged dept_code/dept_name.
 */
export function mergeDeptElevenTwelve(rows) {
  if (!rows || !rows.length) return rows || [];

  // Vind de naam van afdeling 11 (als die voorkomt in input)
  let nameOf11 = '';
  for (let i = 0; i < rows.length; i++) {
    const code = String(rows[i].dept_code || '').trim();
    if (code === '11' && rows[i].dept_name) {
      nameOf11 = String(rows[i].dept_name);
      break;
    }
  }

  return rows.map(function(r) {
    const code = String(r.dept_code || '').trim();
    if (code === '12') {
      return Object.assign({}, r, {
        dept_code: '11',
        dept_name: nameOf11 || r.dept_name,
      });
    }
    return r;
  });
}

/**
 * Quick check helper: returns true if a code is "12-as-11" (i.e. originally 12).
 * Useful for filtering/styling if needed elsewhere.
 */
export function isMergedDept(originalCode) {
  return String(originalCode || '').trim() === '12';
}
