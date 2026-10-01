import ExcelJS from 'exceljs';
import { days } from './domain.mjs';
const status = { submitted: 'На согласовании руководителя', manager_approved: 'Согласовано руководителем', revision: 'Запрошен пересмотр' };
export async function workbook(data) {
    const person = id => data.people?.find(p => p.id === id)?.name || id || '';
    const timestamp = value => value ? new Date(value).toISOString() : '';
    const book = new ExcelJS.Workbook();
    book.creator = 'План отпусков';
    book.created = new Date();
    const meta = book.addWorksheet('Согласование');
    meta.addRows([['План отпусков', data.year], ['Версия', data.plan.revision], ['Статус', ({ open: 'Подготовка', hr_approved: 'На утверждении директора', approved: 'Утвержден' })[data.plan.status]], ['Кадровик', person(data.plan.hr_by)], ['Дата согласования кадровиком (UTC)', timestamp(data.plan.hr_at)], ['Генеральный директор', person(data.plan.director_by)], ['Дата утверждения (UTC)', timestamp(data.plan.director_at)]]);
    const plan = book.addWorksheet('План отпусков');
    plan.addRow(['Сотрудник', 'Подразделение', 'Начало', 'Окончание', 'Календарных дней', 'Статус', 'Версия заявки', 'Комментарий', 'Согласовал руководитель', 'Дата согласования (UTC)']);
    for (const r of data.requests)
        for (const p of r.periods)
            plan.addRow([r.name, r.department, p.start, p.end, days(p.start, p.end), status[r.status], r.version, r.comment, r.manager_name || person(r.manager_by), timestamp(r.manager_at)]);
    const conflicts = book.addWorksheet('Все пересечения');
    conflicts.addRow(['Сотрудник 1', 'Подразделение 1', 'Сотрудник 2', 'Подразделение 2', 'С', 'По', 'Общих дней', 'Решение', 'Комментарий', 'Принял решение']);
    for (const c of data.conflicts)
        conflicts.addRow([c.a_name, c.a_department, c.b_name, c.b_department, c.start, c.end, c.days, c.decision ? 'Совпадение принято' : 'Требует решения', c.decision?.comment || '', c.decision?.actor_name || '']);
    for (const sheet of book.worksheets) {
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123C56' } };
        sheet.columns.forEach((col, i) => { col.width = i === 0 ? 32 : 25; col.alignment = { vertical: 'top', wrapText: true }; });
        if (sheet !== meta)
            sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount } };
    }
    return book.xlsx.writeBuffer();
}
