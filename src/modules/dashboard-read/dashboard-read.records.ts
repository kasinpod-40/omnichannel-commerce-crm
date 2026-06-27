/**
 * แหล่งโหลด Record กลางของ Dashboard Read API
 *
 * หน้า Dashboard, Customers, Conversations, Pipelines, Orders และ Marketplaces
 * ใช้ตาราง Lark ชุดเดียวกัน หากแต่ละ Feature เรียก Repository ตรงเองจะเกิด
 * request ซ้ำเมื่อผู้ใช้เปลี่ยนหน้าอย่างรวดเร็ว ไฟล์นี้จึงรวม Cache และ
 * in-flight deduplication ไว้จุดเดียว
 */
import type { Env } from '../../config/env';
import { listActivities } from '../activities/activity.repository';
import { listConversations } from '../conversations/conversation.repository';
import { listCustomers } from '../customers/customer.repository';
import { listOrders } from '../orders/order.repository';
import { listPipelines } from '../pipeline/pipeline.repository';
import { withDashboardReadCache } from './dashboard-read.cache';

const RECORD_CACHE_TTL_MS = 30_000;

function key(...parts: string[]): string {
    return ['dashboard-records', ...parts].join(':');
}

/** อ่าน Customers พร้อม Cache กลางที่ทุกหน้าใช้ร่วมกัน */
export function getDashboardCustomers(env: Env) {
    return withDashboardReadCache(
        key('customers', env.LARK_APP_TOKEN, env.CUSTOMERS_TABLE_ID),
        RECORD_CACHE_TTL_MS,
        () => listCustomers(env)
    );
}

/** อ่าน Conversations ครั้งเดียวต่อช่วง Cache แม้ List/Detail เรียกพร้อมกัน */
export function getDashboardConversations(env: Env) {
    return withDashboardReadCache(
        key('conversations', env.LARK_APP_TOKEN, env.CONVERSATIONS_TABLE_ID),
        RECORD_CACHE_TTL_MS,
        () => listConversations(env)
    );
}

/** อ่าน Sales Pipeline สำหรับ Dashboard Board และ Detail */
export function getDashboardPipelines(env: Env) {
    return withDashboardReadCache(
        key('pipelines', env.LARK_APP_TOKEN, env.PIPELINE_TABLE_ID),
        RECORD_CACHE_TTL_MS,
        () => listPipelines(env)
    );
}

/** อ่าน Orders สำหรับ Dashboard, Orders และ Marketplace status */
export function getDashboardOrders(env: Env) {
    return withDashboardReadCache(
        key('orders', env.LARK_APP_TOKEN, env.ORDERS_TABLE_ID),
        RECORD_CACHE_TTL_MS,
        () => listOrders(env)
    );
}

/** อ่าน Activities สำหรับ Summary และ Timeline ที่ต้องใช้ข้อมูลล่าสุดร่วมกัน */
export function getDashboardActivities(env: Env) {
    return withDashboardReadCache(
        key('activities', env.LARK_APP_TOKEN, env.ACTIVITIES_TABLE_ID),
        RECORD_CACHE_TTL_MS,
        () => listActivities(env)
    );
}
