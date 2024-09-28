import { Env, Input } from 'hono'
import { ClientRateLimitInfo, ConfigType as RateLimitConfiguration, Store } from 'hono-rate-limiter'
import { Pool, PoolOptionsExplicit } from 'postgres-pool'

import { detailedRecordsQuery, initQuery, summaryRecordsQuery } from './migrations'
import { Options } from './types'


/**
 * A `Store` for the `hono-rate-limiter` package that stores hit counts in PostgreSQL.
 */
class PostgresStore<
  E extends Env = Env,
  P extends string = string,
  I extends Input = Input
> implements Store<E, P, I> {
  /**
   * The database configuration 
   */
  config: PoolOptionsExplicit

  /**
   * Optional value that the store prepends to keys
   * Used by the double-count check to avoid false-positives when a key is counted twice, but with different prefixes
   */
  prefix: string

  /**
   * The database connection pool.
   */
  pool: any

  /**
   * The duration of time before which all hit counts are reset (in milliseconds).
   */
  windowMs!: number

  storeType: string

  constructor (options: Options) {
    const { config, prefix, storeType } = options
    this.config = config
    this.prefix = prefix
    this.storeType = storeType || 'summary'
  }

  // TODO: Rename this
  get mapStoreType () {
    return this.storeType === 'summary' ? 'agg' : 'ind'
  }

  doSummaryRecord () {
    return this.storeType === 'summary'
  }

  doDetailedRecord() {
    return this.storeType === 'detailed'
  }

  /**
   * Method that actually initializes the store. Must be synchronous.
   * This method is optional, it will be called only if it exists.
   * @param  options {Options} - The options used to setup express-rate-limit.
   */
  async init (options: RateLimitConfiguration<E, P, I>): Promise<void> {
    this.windowMs = options.windowMs
    this.pool = new Pool(this.config)
  }

  //TODO: Rename and improve 
  async runMigrations (): Promise<void> {
    const initQueryResponse = await this.pool.query(initQuery)
    console.log('initQueryResponse =>', initQueryResponse)

    if (this.doSummaryRecord()) {
      const summaryQueryResponse = await this.pool.query(summaryRecordsQuery)
      console.log('summaryQueryResponse =>', summaryQueryResponse)
    } else {
      await this.pool.query(detailedRecordsQuery)
    } 
  }


  /**
   * Method to increment a client's hit counter.
   * @param key {string} - The identifier for a client.
   * @returns {ClientRateLimitInfo} - The number of hits and reset time for that client.
   */
  async increment (key: string): Promise<ClientRateLimitInfo> {
    const insertQuery = `SELECT * FROM rate_limit.${this.mapStoreType}_increment($1, $2, $3) AS (count int, expires_at timestamptz);`
    
    try {
      const result = await this.pool.query(insertQuery, [key, this.prefix,this.windowMs])
      let totalHits: number = 0
      let resetTime: Date | undefined

      if (result.rows.length > 0) {
        totalHits = parseInt(result.rows[0].count)
        resetTime = result.rows[0].expires_at
      }
      return {
        totalHits,
        resetTime
      }
    } catch (err) {
      const error = err as Error
      // TODO: check error then runMigrations to setup. 
      if (error.message === 'schema "rate_limit" does not exist') {
        await this.runMigrations()
      }
      throw err
    }
  }

  /**
   * Method to decrement a client's hit counter.
   * @param  key {string} - The identifier for a client.
   */
  async decrement (key: string): Promise<void> {
    const decrementQuery = `SELECT * FROM rate_limit.${this.mapStoreType}_decrement($1, $2);`

    try {
      await this.pool.query(decrementQuery, [key, this.prefix])
    } catch (err) {
      const error = err as Error
      throw error
    }
  }

  /**
   * Method to reset a client's hit counter.
   * @param  key {string} - The identifier for a client.
   */
  async resetKey (key: string): Promise<void> {
    const resetQuery = `'SELECT * FROM rate_limit.${this.mapStoreType}_reset_key($1, $2)',`

    try {
      await this.pool.query(resetQuery, [key, this.prefix])
    } catch (err) {
      // console.error(err)
      throw err
    }
  }

  /**
   * Method to reset everyone's hit counter.
   * This method is optional, it is never called by express-rate-limit.
   */
  async resetAll (): Promise<void> {
    const resetAllQuery = `'SELECT * FROM rate_limit.${this.mapStoreType}_reset_session($1);'`

    try {
      await this.pool.query(resetAllQuery, [this.prefix])
    } catch (err) {
      // console.error(err)
      throw err
    }
  }
}

export default PostgresStore
